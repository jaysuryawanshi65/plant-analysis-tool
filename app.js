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
  try {
    const { result, image, analysis } = req.body;
  
    if (!result || !image) {
      return res.status(400).json({
        success: false,
        error: "Missing required data for PDF generation"
      });
    }

    // Create PDF document
    const doc = new PDFDocument({
      size: 'A4',
      margin: 50,
      bufferPages: true,
      autoFirstPage: true,
      info: {
        Title: 'Plant Analysis Report',
        Author: 'PlantScan Pro',
        Subject: 'Plant Analysis',
        Keywords: 'plant, analysis, report'
      }
    });

    // Set response headers early
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', 'attachment; filename=Plant_Analysis_Report.pdf');

    // Pipe the PDF directly to the response
    doc.pipe(res);

    // Add content to the PDF
    try {
      // Add title
      doc.font('Helvetica-Bold')
         .fontSize(24)
         .text("Plant Analysis Report", { align: "center" })
         .moveDown();

      // Add timestamp
      doc.font('Helvetica')
         .fontSize(12)
         .text(`Generated on: ${new Date().toLocaleString()}`, { align: "right" })
         .moveDown();

      // Add analysis summary
      if (analysis && typeof analysis === 'object') {
        doc.font('Helvetica-Bold')
           .fontSize(16)
           .text("Analysis Summary", { underline: true })
           .moveDown();

        Object.entries(analysis).forEach(([key, value]) => {
          if (value && typeof value === 'string') {
            doc.font('Helvetica-Bold')
               .fontSize(14)
               .text(key.charAt(0).toUpperCase() + key.slice(1))
               .font('Helvetica')
               .fontSize(12)
               .text(value)
               .moveDown(0.5);
          }
        });
      }

      // Add detailed analysis
      if (result && typeof result === 'string') {
        doc.font('Helvetica-Bold')
           .fontSize(16)
           .text("Detailed Analysis", { underline: true })
           .moveDown()
           .font('Helvetica')
           .fontSize(12)
           .text(result)
           .moveDown();
      }

      // Add image if available
      if (image && typeof image === 'string') {
        try {
          const base64Data = image.replace(/^data:image\/\w+;base64,/, "");
          const imageBuffer = Buffer.from(base64Data, "base64");
          
          // Calculate image dimensions while maintaining aspect ratio
          const maxWidth = 500;
          const maxHeight = 300;
          
          doc.image(imageBuffer, {
            fit: [maxWidth, maxHeight],
            align: 'center',
            valign: 'center'
          });
          doc.moveDown();
        } catch (imageError) {
          console.error('Error adding image to PDF:', imageError);
          doc.text('Note: Image could not be included in the report', { align: 'center' });
        }
      }

      // Add footer
      doc.font('Helvetica')
         .fontSize(10)
         .text("Generated by PlantScan Pro", {
           align: "center",
           color: "grey"
         });

      // Finalize the PDF
      doc.end();

    } catch (contentError) {
      console.error('Error adding content to PDF:', contentError);
      // If we encounter an error while adding content, we need to end the response
      if (!res.headersSent) {
        res.status(500).json({
          success: false,
          error: "Failed to generate PDF content",
          details: contentError.message
        });
      }
    }

  } catch (error) {
    console.error("Error in PDF generation:", error);
    if (!res.headersSent) {
      res.status(500).json({
        success: false,
        error: "Failed to generate PDF report",
        details: error.message
      });
    }
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