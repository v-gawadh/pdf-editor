// Initialize PDF.js worker
pdfjsLib.GlobalWorkerOptions.workerSrc = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js';

// Initialize variables
let pdfDoc = null,
    pageNum = 1,
    pageRendering = false,
    pageNumPending = null,
    scale = 1.2,
    textLayer = null,
    textLayerDiv = null,
    CMAP_URL = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/cmaps/',
    CMAP_PACKED = true,
    ENABLE_XFA = true;

// Get page elements
const canvas = document.createElement('canvas'),
    ctx = canvas.getContext('2d'),
    pdfViewer = document.getElementById('pdf-viewer'),
    fileInput = document.getElementById('file-input'),
    pageNumInput = document.getElementById('page-num');

// Setup canvas and container
canvas.id = 'pdf-canvas';
pdfViewer.innerHTML = '';
const canvasContainer = document.createElement('div');
canvasContainer.style.position = 'relative';
canvasContainer.appendChild(canvas);
pdfViewer.appendChild(canvasContainer);

// Render the page
function renderPage(num) {
    if (!pdfDoc) return;
    pageRendering = true;
    pdfDoc.getPage(num).then(function(page) {
        const viewport = page.getViewport({scale: scale});
        canvas.height = viewport.height;
        canvas.width = viewport.width;
        
        const renderContext = {
            canvasContext: ctx,
            viewport: viewport
        };

        page.render(renderContext).promise.then(function() {
            pageRendering = false;
            pageNumInput.value = num;
            
            if (pageNumPending !== null) {
                renderPage(pageNumPending);
                pageNumPending = null;
            }
            
            // After rendering, extract text and create overlays
            page.getTextContent().then(function(textContent) {
                // Remove old text boxes
                document.querySelectorAll('.text-box').forEach(box => box.remove());
                // Group items into sections (blocks/paragraphs) by proximity
                let sections = [];
                const thresholdY = 20; // vertical gap threshold for new section
                textContent.items.forEach(function(item) {
                    const tx = pdfjsLib.Util.transform(viewport.transform, item.transform);
                    const x = tx[4];
                    const y = canvas.height - tx[5];
                    const width = item.width * scale;
                    const height = item.height * scale;
                    // Find section by y proximity
                    let section = sections.find(s => Math.abs(s.lastY - (y - height)) < thresholdY);
                    if (!section) {
                        section = { minX: x, maxX: x + width, minY: y - height, maxY: y, items: [], lastY: y - height };
                        sections.push(section);
                    }
                    section.items.push(item);
                    section.minX = Math.min(section.minX, x);
                    section.maxX = Math.max(section.maxX, x + width);
                    section.minY = Math.min(section.minY, y - height);
                    section.maxY = Math.max(section.maxY, y);
                    section.lastY = y - height;
                });
                // Create one text box per section
                sections.forEach(function(section) {
                    const div = document.createElement('div');
                    div.className = 'text-box';
                    div.style.position = 'absolute';
                    div.style.left = `${section.minX}px`;
                    div.style.top = `${section.minY}px`;
                    div.style.width = `${section.maxX - section.minX}px`;
                    div.style.height = `${section.maxY - section.minY}px`;
                    div.style.background = 'rgba(0,123,255,0.08)';
                    div.style.border = '1px dashed #007bff';
                    div.style.cursor = 'pointer';
                    div.style.pointerEvents = 'auto';
                    div.style.zIndex = '10';
                    div.title = section.items.map(i => i.str).join(' ');
                    div.setAttribute('data-text', div.title);
                    div.onclick = createTextClickHandler(section);
                    pdfViewer.appendChild(div);
                });
                canvas.style.userSelect = 'text';
            });
        });
    });
}

// Queue page rendering
function queueRenderPage(num) {
    if (pageRendering) {
        pageNumPending = num;
    } else {
        renderPage(num);
    }
}

// Create handler for text box clicks
function createTextClickHandler(section) {
    return async function(e) {
        if (window.editMode) {
            handleEditText(section);
        } else if (window.deleteTextMode) {
            handleDeleteText(section);
        } else if (window.highlightMode) {
            handleHighlight(section);
        }
    };
}

// File input change handler
fileInput.addEventListener('change', function(event) {
    const file = event.target.files[0];
    if (file) {
        const reader = new FileReader();
        reader.onload = function(e) {
            const typedarray = new Uint8Array(e.target.result);
            pdfjsLib.getDocument({data: typedarray}).promise.then(function(pdf) {
                pdfDoc = pdf;
                document.getElementById('page-count').textContent = `/ ${pdf.numPages}`;
                pageNum = 1;
                renderPage(pageNum);
            }).catch(function(error) {
                console.error('Error loading PDF:', error);
                alert('Error loading PDF: ' + error.message);
            });
        };
        reader.readAsArrayBuffer(file);
    }
});

// Render the page
async function renderPage(num) {
    if (!pdfDoc) return;
    pageRendering = true;

    try {
        const page = await pdfDoc.getPage(num);
        const viewport = page.getViewport({scale: scale});
        
        // Setup canvas
        canvas.height = viewport.height;
        canvas.width = viewport.width;
        
        // Clear previous text layer
        if (textLayerDiv) {
            textLayerDiv.remove();
        }
        
        // Create text layer div
        textLayerDiv = document.createElement('div');
        textLayerDiv.className = 'textLayer';
        Object.assign(textLayerDiv.style, {
            width: `${viewport.width}px`,
            height: `${viewport.height}px`,
            position: 'absolute',
            left: 0,
            top: 0,
            right: 0,
            bottom: 0
        });
        pdfViewer.appendChild(textLayerDiv);
        
        // Render PDF page
        const renderContext = {
            canvasContext: ctx,
            viewport: viewport,
            enableWebGL: true,
            renderInteractiveForms: true
        };
        
        // Start parallel rendering of page content and text layer
        const [renderTask, textContent] = await Promise.all([
            page.render(renderContext).promise,
            page.getTextContent({
                normalizeWhitespace: true,
                disableCombineTextItems: false
            })
        ]);
        
        // Create text layer
        textLayer = pdfjsLib.renderTextLayer({
            textContent: textContent,
            container: textLayerDiv,
            viewport: viewport,
            textDivs: []
        });
        
        await textLayer.render();
        
        // Update UI
        pageRendering = false;
        pageNumInput.value = num;
        
        if (pageNumPending !== null) {
            renderPage(pageNumPending);
            pageNumPending = null;
        }
        
        // Make text layer selectable
        textLayerDiv.style.userSelect = 'text';
        textLayerDiv.style.cursor = 'text';
        
        // Create edit overlays
        createTextOverlays(textContent, viewport);
        
    } catch (error) {
        console.error('Error rendering page:', error);
        pageRendering = false;
    }
}

// Helper function to create text overlays
function createTextOverlays(textContent, viewport) {
    document.querySelectorAll('.text-box').forEach(box => box.remove());
    
    const sections = groupTextIntoSections(textContent, viewport);
    sections.forEach(section => {
        const div = createTextBox(section);
        pdfViewer.appendChild(div);
    });
    
    canvas.style.userSelect = 'text';
}

// Helper function to group text items into sections
function groupTextIntoSections(textContent, viewport) {
    const sections = [];
    const thresholdY = 20;

    textContent.items.forEach(item => {
        const transform = pdfjsLib.Util.transform(viewport.transform, item.transform);
        const x = transform[4];
        const y = canvas.height - transform[5];
        const width = item.width * scale;
        const height = item.height * scale;

        let section = sections.find(s => Math.abs(s.lastY - (y - height)) < thresholdY);
        if (!section) {
            section = { minX: x, maxX: x + width, minY: y - height, maxY: y, items: [], lastY: y - height };
            sections.push(section);
        }

        section.items.push(item);
        section.minX = Math.min(section.minX, x);
        section.maxX = Math.max(section.maxX, x + width);
        section.minY = Math.min(section.minY, y - height);
        section.maxY = Math.max(section.maxY, y);
        section.lastY = y - height;
    });

    return sections;
}

// Helper function to create a text box for a section
function createTextBox(section) {
    const div = document.createElement('div');
    div.className = 'text-box';
    
    // Create actual text content wrapper
    const textWrapper = document.createElement('div');
    textWrapper.className = 'text-content';
    textWrapper.textContent = section.items.map(i => i.str).join(' ');
    
    // Position and size the text box
    Object.assign(div.style, {
        left: `${section.minX}px`,
        top: `${section.minY}px`,
        width: `${section.maxX - section.minX}px`,
        height: `${section.maxY - section.minY}px`,
    });

    div.appendChild(textWrapper);
    div.setAttribute('data-text', textWrapper.textContent);
    
    // Add event listeners for different modes
    div.addEventListener('mouseenter', function() {
        if (window.editMode || window.deleteTextMode || window.highlightMode) {
            div.classList.add('edit-mode');
        }
    });

    div.addEventListener('mouseleave', function() {
        div.classList.remove('edit-mode');
    });

    div.addEventListener('click', function(e) {
        // Only handle click if in edit mode
        if (window.editMode || window.deleteTextMode || window.highlightMode) {
            createTextClickHandler(section)(e);
        }
    });

    // Enable text selection
    div.addEventListener('mousedown', function(e) {
        if (!window.editMode && !window.deleteTextMode && !window.highlightMode) {
            // Allow default text selection behavior
            e.stopPropagation();
        }
    });
    
    return div;
}

// Event handlers for navigation and zoom
document.getElementById('zoom-in').addEventListener('click', function() {
    scale += 0.2;
    renderPage(pageNum);
});

document.getElementById('zoom-out').addEventListener('click', function() {
    scale = Math.max(0.2, scale - 0.2);
    renderPage(pageNum);
});

document.getElementById('prev-page').addEventListener('click', function() {
    if (pdfDoc && pageNum > 1) {
        pageNum--;
        queueRenderPage(pageNum);
    }
});

document.getElementById('next-page').addEventListener('click', function() {
    if (pdfDoc && pageNum < pdfDoc.numPages) {
        pageNum++;
        queueRenderPage(pageNum);
    }
});

pageNumInput.addEventListener('change', function() {
    let val = parseInt(pageNumInput.value);
    if (pdfDoc && val >= 1 && val <= pdfDoc.numPages) {
        pageNum = val;
        queueRenderPage(pageNum);
    }
});

// Placeholder for save functionality

// Helper functions for text operations
async function handleEditText(section) {
    // Create edit overlay
    const overlay = document.createElement('div');
    Object.assign(overlay.style, {
        position: 'absolute',
        left: `${section.minX}px`,
        top: `${section.minY}px`,
        width: `${section.maxX - section.minX}px`,
        height: `${section.maxY - section.minY}px`,
        background: '#fff',
        border: '2px solid #2196F3',
        borderRadius: '2px',
        zIndex: '100',
        padding: '2px'
    });

    // Create editable textarea
    const textarea = document.createElement('textarea');
    Object.assign(textarea.style, {
        width: '100%',
        height: '100%',
        border: 'none',
        padding: '0',
        margin: '0',
        resize: 'none',
        fontFamily: 'Arial, sans-serif',
        fontSize: `${section.maxY - section.minY}px`,
        lineHeight: '1',
        background: 'transparent'
    });
    textarea.value = section.items.map(i => i.str).join(' ');

    // Add buttons container
    const buttons = document.createElement('div');
    Object.assign(buttons.style, {
        position: 'absolute',
        right: '-2px',
        top: '100%',
        marginTop: '4px',
        display: 'flex',
        gap: '4px'
    });

    // Add OK button
    const okButton = document.createElement('button');
    okButton.textContent = 'OK';
    Object.assign(okButton.style, {
        padding: '4px 12px',
        background: '#2196F3',
        color: '#fff',
        border: 'none',
        borderRadius: '2px',
        cursor: 'pointer'
    });

    // Add Cancel button
    const cancelButton = document.createElement('button');
    cancelButton.textContent = 'Cancel';
    Object.assign(cancelButton.style, {
        padding: '4px 12px',
        background: '#fff',
        color: '#2196F3',
        border: '1px solid #2196F3',
        borderRadius: '2px',
        cursor: 'pointer'
    });

    buttons.appendChild(okButton);
    buttons.appendChild(cancelButton);
    overlay.appendChild(textarea);
    overlay.appendChild(buttons);
    pdfViewer.appendChild(overlay);
    textarea.focus();

    // Handle save
    const saveChanges = async () => {
        const newText = textarea.value.trim();
        if (newText && newText !== section.items.map(i => i.str).join(' ')) {
            await updatePDF(async (page) => {
                const pdfHeight = page.getHeight();
                const yPos = pdfHeight - section.minY - (section.maxY - section.minY);
                // Cover old text
                page.drawRectangle({
                    x: section.minX,
                    y: yPos,
                    width: section.maxX - section.minX,
                    height: section.maxY - section.minY,
                    color: PDFLib.rgb(1, 1, 1),
                });
                // Draw new text
                page.drawText(newText, {
                    x: section.minX,
                    y: yPos,
                    size: section.maxY - section.minY,
                    color: PDFLib.rgb(0, 0, 0),
                });
            });
        }
        overlay.remove();
        window.editMode = false;
    };

    // Handle cancel
    const cancelEdit = () => {
        overlay.remove();
        window.editMode = false;
    };

    okButton.addEventListener('click', saveChanges);
    cancelButton.addEventListener('click', cancelEdit);
    textarea.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
            saveChanges();
        } else if (e.key === 'Escape') {
            cancelEdit();
        }
    });
}
}

async function handleDeleteText(section) {
    await updatePDF(async (page) => {
        const pdfHeight = page.getHeight();
        const yPos = pdfHeight - section.minY - (section.maxY - section.minY);
        page.drawRectangle({
            x: section.minX,
            y: yPos,
            width: section.maxX - section.minX,
            height: section.maxY - section.minY,
            color: PDFLib.rgb(1, 1, 1),
        });
    });
    window.deleteTextMode = false;
}

async function handleHighlight(section) {
    await updatePDF(async (page) => {
        const pdfHeight = page.getHeight();
        const yPos = pdfHeight - section.minY - (section.maxY - section.minY);
        page.drawRectangle({
            x: section.minX,
            y: yPos,
            width: section.maxX - section.minX,
            height: section.maxY - section.minY,
            color: PDFLib.rgb(1, 1, 0),
            opacity: 0.5,
        });
    });
    window.highlightMode = false;
}

async function updatePDF(modifyPage) {
    const file = fileInput.files[0];
    if (!file) return;
    
    const arrayBuffer = await file.arrayBuffer();
    const pdfDocLib = await PDFLib.PDFDocument.load(arrayBuffer);
    const pages = pdfDocLib.getPages();
    const page = pages[pageNum - 1];
    
    await modifyPage(page);
    
    const newPdfBytes = await pdfDocLib.save();
    const pdf = await pdfjsLib.getDocument(newPdfBytes).promise;
    pdfDoc = pdf;
    renderPage(pageNum);
}

// Text Editing Event Listeners
document.getElementById('add-text').addEventListener('click', function() {
    window.addTextMode = true;
    alert('Add Text: Click on the PDF to add new text.');
    pdfViewer.onclick = async function(e) {
        if (!window.addTextMode) return;
        
        const rect = pdfViewer.getBoundingClientRect();
        const x = e.clientX - rect.left;
        const y = e.clientY - rect.top;
        const newText = prompt('Enter new text:');
        
        if (newText) {
            await updatePDF(async (page) => {
                page.drawText(newText, {
                    x: x,
                    y: page.getHeight() - y,
                    size: 16,
                    color: PDFLib.rgb(0, 0, 0),
                });
            });
        }
        
        window.addTextMode = false;
        pdfViewer.onclick = null;
    };
});
// Event Listeners for Text Operations
document.getElementById('edit-text').addEventListener('click', function() {
    // Toggle edit mode
    window.editMode = !window.editMode;
    
    // Update button state
    this.style.background = window.editMode ? '#2196F3' : '';
    this.style.color = window.editMode ? '#fff' : '';
    
    // Update cursor for all text boxes
    document.querySelectorAll('.text-box').forEach(box => {
        if (window.editMode) {
            box.classList.add('edit-mode');
        } else {
            box.classList.remove('edit-mode');
        }
    });
    
    // Show/hide tooltip
    if (window.editMode) {
        this.title = 'Click again to exit edit mode';
    } else {
        this.title = 'Click to enter edit mode';
    }
});

document.getElementById('delete-text').addEventListener('click', function() {
    window.deleteTextMode = true;
    alert('Delete Text: Click on a highlighted text box to delete.');
});

document.getElementById('highlight').addEventListener('click', function() {
    window.highlightMode = true;
    alert('Highlight: Click a text box to highlight.');
});

document.getElementById('underline').addEventListener('click', function() {
    window.underlineMode = true;
    alert('Underline: Click a text box to underline.');
    document.querySelectorAll('.text-box').forEach(box => {
        box.onclick = async function(e) {
            if (!window.underlineMode) return;
            const section = {
                minX: parseFloat(box.style.left),
                minY: parseFloat(box.style.top),
                maxX: parseFloat(box.style.left) + parseFloat(box.style.width),
                maxY: parseFloat(box.style.top) + parseFloat(box.style.height)
            };
            await updatePDF(async (page) => {
                page.drawLine({
                    start: { x: section.minX, y: page.getHeight() - section.minY - 2 },
                    end: { x: section.maxX, y: page.getHeight() - section.minY - 2 },
                    thickness: 2,
                    color: PDFLib.rgb(0, 0, 0),
                });
            });
            window.underlineMode = false;
        };
    });
});

document.getElementById('strikethrough').addEventListener('click', function() {
    window.strikeMode = true;
    alert('Strikethrough: Click a text box to strikethrough.');
    document.querySelectorAll('.text-box').forEach(box => {
        box.onclick = async function(e) {
            if (!window.strikeMode) return;
            const section = {
                minX: parseFloat(box.style.left),
                minY: parseFloat(box.style.top),
                maxX: parseFloat(box.style.left) + parseFloat(box.style.width),
                maxY: parseFloat(box.style.top) + parseFloat(box.style.height)
            };
            await updatePDF(async (page) => {
                page.drawLine({
                    start: { x: section.minX, y: page.getHeight() - section.minY - (section.maxY - section.minY) / 2 },
                    end: { x: section.maxX, y: page.getHeight() - section.minY - (section.maxY - section.minY) / 2 },
                    thickness: 2,
                    color: PDFLib.rgb(1, 0, 0),
                });
            });
            window.strikeMode = false;
        };
    });
});

document.getElementById('add-comment').addEventListener('click', function() {
    window.commentMode = true;
    alert('Add Comment: Click a text box to add a comment.');
    document.querySelectorAll('.text-box').forEach(box => {
        box.onclick = async function(e) {
            if (!window.commentMode) return;
            const section = {
                minX: parseFloat(box.style.left),
                minY: parseFloat(box.style.top),
                maxX: parseFloat(box.style.left) + parseFloat(box.style.width),
                maxY: parseFloat(box.style.top) + parseFloat(box.style.height)
            };
            const comment = prompt('Enter your comment:');
            if (comment) {
                await updatePDF(async (page) => {
                    page.drawText(`🗨 ${comment}`, {
                        x: section.maxX + 5,
                        y: page.getHeight() - section.minY,
                        size: 12,
                        color: PDFLib.rgb(0, 0, 1),
                    });
                });
            }
            window.commentMode = false;
        };
    });
});

// Export functionality
document.getElementById('export-pdf').addEventListener('click', function() {
    if (!pdfDoc) {
        alert('Please load a PDF first.');
        return;
    }
    
    updatePDF(async (page) => {}).then(() => {
        const link = document.createElement('a');
        link.href = canvas.toDataURL('application/pdf');
        link.download = 'edited.pdf';
        link.click();
    });
});
