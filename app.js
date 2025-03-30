require("dotenv").config();
const express = require("express");
const multer = require("multer");
const PDFDocument = require("pdfkit");
const fs = require("fs");
const fsPromises = fs.promises;
const path = require("path");
const { GoogleGenerativeAI } = require("@google/generative-ai");
const cors = require("cors");
const rateLimit = require("express-rate-limit");

const app = express();
const port = process.env.PORT || 3000;

// Middleware
app.use(cors());
app.use(express.json({ limit: "10mb" }));

// Serve static files from the public directory
app.use(express.static(path.join(__dirname, "public")));

// Route for the root path
app.get("/", (req, res) => {
  res.sendFile(path.join(__dirname, "public", "index.html"));
});

// Rate limiting
const limiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 100 // limit each IP to 100 requests per windowMs
});
app.use(limiter);

// Configure multer for memory storage instead of disk storage for Vercel
const storage = multer.memoryStorage();
const upload = multer({
  storage: storage,
  limits: {
    fileSize: 5 * 1024 * 1024, // 5MB limit
  },
  fileFilter: (req, file, cb) => {
    if (!file.mimetype.startsWith('image/')) {
      return cb(new Error('Only image files are allowed!'), false);
    }
    cb(null, true);
  }
});

// Initialize Google Generative AI
const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);

// Helper function to parse plant analysis
function parsePlantAnalysis(text) {
  const analysis = {
    species: "",
    health: "",
    water: "",
    light: "",
    careInstructions: "",
    characteristics: "",
    interestingFacts: ""
  };

  // Basic parsing logic - can be enhanced based on actual response format
  const lines = text.split('\n');
  lines.forEach(line => {
    line = line.toLowerCase();
    if (line.includes('species')) analysis.species = line.split(':')[1]?.trim() || "Unknown";
    if (line.includes('health')) analysis.health = line.split(':')[1]?.trim() || "Good";
    if (line.includes('water')) analysis.water = line.split(':')[1]?.trim() || "Moderate";
    if (line.includes('light')) analysis.light = line.split(':')[1]?.trim() || "Partial Sun";
    if (line.includes('care')) analysis.careInstructions = line.split(':')[1]?.trim() || "";
    if (line.includes('characteristic')) analysis.characteristics = line.split(':')[1]?.trim() || "";
    if (line.includes('fact')) analysis.interestingFacts = line.split(':')[1]?.trim() || "";
  });

  return analysis;
}

// Routes
app.post("/analyze", upload.single("image"), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ 
        error: "No image file uploaded",
        details: "Please select an image file to analyze"
      });
    }

    const imageBuffer = req.file.buffer;
    const imageData = imageBuffer.toString('base64');

    // Use the Gemini model to analyze the image
    const model = genAI.getGenerativeModel({ model: "gemini-1.5-flash" });
    const result = await model.generateContent([
      "Analyze this plant image and provide a structured analysis including: species name, health status, water requirements, light requirements, care instructions, characteristics, and interesting facts. Format the response with clear labels for each section.",
      {
        inlineData: {
          mimeType: req.file.mimetype,
          data: imageData,
        },
      },
    ]);

    const plantInfo = result.response.text();
    const parsedAnalysis = parsePlantAnalysis(plantInfo);

    // Respond with structured analysis
    res.json({
      success: true,
      result: plantInfo,
      analysis: parsedAnalysis,
      image: `data:${req.file.mimetype};base64,${imageData}`,
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    console.error("Error analyzing image:", error);
    res.status(500).json({ 
      success: false,
      error: "An error occurred while analyzing the image",
      details: error.message
    });
  }
});

// Download PDF route with in-memory PDF generation
app.post("/download", express.json(), async (req, res) => {
  const { result, image, analysis } = req.body;
  
  if (!result || !image) {
    return res.status(400).json({
      success: false,
      error: "Missing required data for PDF generation"
    });
  }

  try {
    // Create PDF in memory
    const doc = new PDFDocument({
      size: 'A4',
      margin: 50,
      bufferPages: true
    });

    // Create a buffer to store the PDF
    const chunks = [];
    
    // Handle document errors
    doc.on('error', (err) => {
      console.error('Error in PDF generation:', err);
      throw new Error('PDF generation failed');
    });

    doc.on('data', chunk => chunks.push(chunk));

    // Create a promise to handle the PDF generation
    const pdfPromise = new Promise((resolve, reject) => {
      doc.on('end', () => {
        resolve(Buffer.concat(chunks));
      });

      doc.on('error', reject);
    });

    // Add content to the PDF with improved formatting and error handling
    try {
      // Add title
      doc.fontSize(24)
         .text("Plant Analysis Report", { align: "center" })
         .moveDown();

      // Add timestamp
      doc.fontSize(12)
         .text(`Generated on: ${new Date().toLocaleString()}`, { align: "right" })
         .moveDown();

      // Add analysis sections if available
      if (analysis && typeof analysis === 'object') {
        doc.fontSize(16)
           .text("Analysis Summary", { underline: true })
           .moveDown();

        Object.entries(analysis).forEach(([key, value]) => {
          if (value && typeof value === 'string') {
            doc.fontSize(14)
               .text(key.charAt(0).toUpperCase() + key.slice(1), { underline: true })
               .moveDown(0.5)
               .fontSize(12)
               .text(value)
               .moveDown();
          }
        });
      }

      // Add detailed analysis
      if (result && typeof result === 'string') {
        doc.fontSize(16)
           .text("Detailed Analysis", { underline: true })
           .moveDown()
           .fontSize(12)
           .text(result, { align: "left" })
           .moveDown();
      }

      // Add image if available
      if (image && typeof image === 'string') {
        try {
          const base64Data = image.replace(/^data:image\/\w+;base64,/, "");
          const buffer = Buffer.from(base64Data, "base64");
          
          doc.image(buffer, {
            fit: [500, 300],
            align: "center",
            valign: "center"
          });
        } catch (imageError) {
          console.error('Error adding image to PDF:', imageError);
          doc.text('Error: Could not add image to report', { align: 'center' });
        }
      }

      // Add footer
      doc.moveDown()
         .fontSize(10)
         .text("Generated by PlantScan Pro", { align: "center" });

      // End the document
      doc.end();

      // Wait for the PDF to be generated
      const pdfBuffer = await pdfPromise;

      // Set response headers
      res.setHeader('Content-Type', 'application/pdf');
      res.setHeader('Content-Disposition', 'attachment; filename=Plant_Analysis_Report.pdf');
      res.setHeader('Content-Length', pdfBuffer.length);

      // Send the PDF
      res.send(pdfBuffer);

    } catch (contentError) {
      console.error('Error adding content to PDF:', contentError);
      throw new Error('Failed to add content to PDF');
    }

  } catch (error) {
    console.error("Error generating PDF report:", error);
    res.status(500).json({ 
      success: false,
      error: "An error occurred while generating the PDF report",
      details: error.message,
      timestamp: new Date().toISOString()
    });
  }
});

// Health check endpoint
app.get("/health", (req, res) => {
  res.json({
    status: "healthy",
    timestamp: new Date().toISOString(),
    version: "1.0.0",
    environment: process.env.NODE_ENV || 'development'
  });
});

// Error handling middleware
app.use((err, req, res, next) => {
  console.error(err.stack);
  res.status(500).json({
    success: false,
    error: "Internal Server Error",
    details: process.env.NODE_ENV === 'development' ? err.message : undefined
  });
});

// Export the Express app for Vercel
module.exports = app;

// Start the server if not running in Vercel
if (process.env.NODE_ENV !== 'production') {
  app.listen(port, () => {
    console.log(`PlantScan Pro server running on port ${port}`);
    console.log(`Environment: ${process.env.NODE_ENV || 'development'}`);
  });
}