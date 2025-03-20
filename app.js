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
const port = process.env.PORT || 5000;

// Middleware
app.use(cors());
app.use(express.json({ limit: "10mb" }));

// Rate limiting
const limiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 100 // limit each IP to 100 requests per windowMs
});
app.use(limiter);

// Configure multer with file size limits and file type filtering
const upload = multer({
  dest: "upload/",
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
app.use(express.static("public"));

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

    const imagePath = req.file.path;
    const imageData = await fsPromises.readFile(imagePath, {
      encoding: "base64",
    });

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

    // Clean up: delete the uploaded file
    await fsPromises.unlink(imagePath);

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

// Download PDF route with enhanced error handling and PDF formatting
app.post("/download", express.json(), async (req, res) => {
  const { result, image, analysis } = req.body;
  
  if (!result || !image) {
    return res.status(400).json({
      success: false,
      error: "Missing required data for PDF generation"
    });
  }

  try {
    // Ensure the reports directory exists
    const reportsDir = path.join(__dirname, "reports");
    await fsPromises.mkdir(reportsDir, { recursive: true });

    // Generate unique filename
    const filename = `plant_analysis_report_${Date.now()}.pdf`;
    const filePath = path.join(reportsDir, filename);
    const writeStream = fs.createWriteStream(filePath);
    const doc = new PDFDocument({
      size: 'A4',
      margin: 50
    });

    doc.pipe(writeStream);

    // Add content to the PDF with improved formatting
    doc.fontSize(24)
       .text("Plant Analysis Report", { align: "center" })
       .moveDown();

    doc.fontSize(12)
       .text(`Generated on: ${new Date().toLocaleString()}`, { align: "right" })
       .moveDown();

    // Add analysis sections if available
    if (analysis) {
      doc.fontSize(16)
         .text("Analysis Summary", { underline: true })
         .moveDown();

      Object.entries(analysis).forEach(([key, value]) => {
        if (value) {
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
    doc.fontSize(16)
       .text("Detailed Analysis", { underline: true })
       .moveDown()
       .fontSize(12)
       .text(result, { align: "left" })
       .moveDown();

    // Add image if available
    if (image) {
      const base64Data = image.replace(/^data:image\/\w+;base64,/, "");
      const buffer = Buffer.from(base64Data, "base64");
      doc.image(buffer, {
        fit: [500, 300],
        align: "center",
        valign: "center"
      });
    }

    // Add footer
    doc.moveDown()
       .fontSize(10)
       .text("Generated by PlantScan Pro", { align: "center" });

    doc.end();

    // Wait for the PDF to be created
    await new Promise((resolve, reject) => {
      writeStream.on("finish", resolve);
      writeStream.on("error", reject);
    });

    // Send the file and clean up
    res.download(filePath, (err) => {
      if (err) {
        console.error("Error downloading PDF:", err);
        res.status(500).json({ 
          success: false,
          error: "Error downloading the PDF report" 
        });
      }
      // Clean up the file after download
      fsPromises.unlink(filePath).catch(console.error);
    });
  } catch (error) {
    console.error("Error generating PDF report:", error);
    res.status(500).json({ 
      success: false,
      error: "An error occurred while generating the PDF report",
      details: error.message
    });
  }
});

// Health check endpoint
app.get("/health", (req, res) => {
  res.json({
    status: "healthy",
    timestamp: new Date().toISOString(),
    version: "1.0.0"
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

// Start the server
app.listen(port, () => {
  console.log(`PlantScan Pro server running on port ${port}`);
  console.log(`Environment: ${process.env.NODE_ENV || 'development'}`);
});