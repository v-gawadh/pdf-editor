// Tesseract.js and OpenCV.js integration for OCR and image detection
// This script will be loaded after pdf.js and pdf-lib

// Load Tesseract.js
const tesseractScript = document.createElement('script');
tesseractScript.src = 'https://cdn.jsdelivr.net/npm/tesseract.js@5.0.0/dist/tesseract.min.js';
document.head.appendChild(tesseractScript);

// Load OpenCV.js
const opencvScript = document.createElement('script');
opencvScript.src = 'https://docs.opencv.org/4.x/opencv.js';
document.head.appendChild(opencvScript);

// Utility to run OCR on a canvas
async function runOCR(canvas) {
    return new Promise((resolve, reject) => {
        Tesseract.recognize(canvas, 'eng', { logger: m => console.log(m) })
            .then(({ data }) => {
                resolve(data.words); // Array of word objects with bounding boxes
            })
            .catch(reject);
    });
}

// Utility to detect images in a canvas using OpenCV.js
function detectImages(canvas) {
    if (!window.cv) return [];
    const src = cv.imread(canvas);
    const gray = new cv.Mat();
    cv.cvtColor(src, gray, cv.COLOR_RGBA2GRAY, 0);
    const thresh = new cv.Mat();
    cv.threshold(gray, thresh, 200, 255, cv.THRESH_BINARY_INV);
    const contours = new cv.MatVector();
    const hierarchy = new cv.Mat();
    cv.findContours(thresh, contours, hierarchy, cv.RETR_EXTERNAL, cv.CHAIN_APPROX_SIMPLE);
    let boxes = [];
    for (let i = 0; i < contours.size(); ++i) {
        const rect = cv.boundingRect(contours.get(i));
        // Filter by size to avoid small noise
        if (rect.width > 30 && rect.height > 30) {
            boxes.push(rect);
        }
    }
    src.delete(); gray.delete(); thresh.delete(); contours.delete(); hierarchy.delete();
    return boxes;
}

window.runOCR = runOCR;
window.detectImages = detectImages;
