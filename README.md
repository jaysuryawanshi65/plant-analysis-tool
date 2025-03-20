# PlantScan Pro 🌿

An advanced plant analysis tool that uses AI to identify plant species, assess health, and provide care recommendations.

## Features

- 🌱 Plant species identification
- 💚 Health status assessment
- 💧 Water requirements analysis
- ☀️ Light requirements detection
- 📱 Responsive design
- 🌓 Dark mode support
- 📄 PDF report generation
- 🖼️ Image upload with drag & drop

## Tech Stack

- Node.js
- Express.js
- Google Gemini AI
- PDFKit
- Multer
- HTML5/CSS3
- JavaScript (ES6+)

## Prerequisites

- Node.js (v14 or higher)
- npm (v6 or higher)
- Google Gemini API key

## Installation

1. Clone the repository:
```bash
git clone https://github.com/yourusername/plant-analysis-tool.git
cd plant-analysis-tool
```

2. Install dependencies:
```bash
npm install
```

3. Create a `.env` file in the root directory and add your configuration:
```env
GEMINI_API_KEY=your_gemini_api_key_here
PORT=3000
NODE_ENV=development
```

4. Start the server:
```bash
npm start
```

## Usage

1. Open your browser and navigate to `http://localhost:3000`
2. Upload a plant image by dragging and dropping or clicking the upload area
3. Click "Analyze Plant" to start the analysis
4. View the results and download a PDF report if needed

## API Endpoints

- `POST /analyze` - Analyze a plant image
- `POST /download` - Generate and download a PDF report
- `GET /health` - Health check endpoint

## Contributing

1. Fork the repository
2. Create your feature branch (`git checkout -b feature/AmazingFeature`)
3. Commit your changes (`git commit -m 'Add some AmazingFeature'`)
4. Push to the branch (`git push origin feature/AmazingFeature`)
5. Open a Pull Request

## License

This project is licensed under the MIT License - see the [LICENSE](LICENSE) file for details.

## Acknowledgments

- Google Gemini AI for plant analysis capabilities
- Font Awesome for icons
- Inter font family for typography 