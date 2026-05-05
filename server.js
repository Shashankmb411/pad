const express = require('express');
const cors = require('cors');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
app.use(cors());
app.use(express.json());
app.use(express.static('.'));

// Storage setup
const storage = multer.diskStorage({
    destination: (req, file, cb) => {
        const dir = './uploads';
        if (!fs.existsSync(dir)) fs.mkdirSync(dir);
        cb(null, dir);
    },
    filename: (req, file, cb) => {
        cb(null, Date.now() + '-' + file.originalname);
    }
});
const upload = multer({ storage, limits: { fileSize: 10 * 1024 * 1024 } }); // 10MB limit

// In-memory store (use Redis/DB in production)
const fileStore = new Map();

// Generate 6-char code
function generateCode() {
    const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
    let code = '';
    for (let i = 0; i < 6; i++) {
        code += chars.charAt(Math.floor(Math.random() * chars.length));
    }
    return code;
}

// Upload endpoint
app.post('/api/upload', upload.single('file'), (req, res) => {
    if (!req.file) return res.status(400).json({ error: 'No file uploaded' });
    
    const code = generateCode();
    const fileData = {
        code,
        filename: req.file.filename,
        originalName: req.file.originalname,
        size: req.file.size,
        mimetype: req.file.mimetype,
        uploadedAt: Date.now(),
        expiresAt: Date.now() + (24 * 60 * 60 * 1000) // 24 hours
    };
    
    fileStore.set(code, fileData);
    
    // Auto-cleanup after 24 hours
    setTimeout(() => {
        if (fileStore.has(code)) {
            const data = fileStore.get(code);
            fs.unlink(path.join('./uploads', data.filename), () => {});
            fileStore.delete(code);
        }
    }, 24 * 60 * 60 * 1000);
    
    res.json({ success: true, code });
});

// Text upload endpoint
app.post('/api/upload-text', (req, res) => {
    const { text } = req.body;
    if (!text) return res.status(400).json({ error: 'No text provided' });
    
    const code = generateCode();
    const filename = Date.now() + '-message.txt';
    const filepath = path.join('./uploads', filename);
    
    fs.writeFileSync(filepath, text);
    
    const fileData = {
        code,
        filename,
        originalName: 'message.txt',
        size: Buffer.byteLength(text),
        mimetype: 'text/plain',
        uploadedAt: Date.now(),
        expiresAt: Date.now() + (24 * 60 * 60 * 1000)
    };
    
    fileStore.set(code, fileData);
    
    setTimeout(() => {
        if (fileStore.has(code)) {
            const data = fileStore.get(code);
            fs.unlink(path.join('./uploads', data.filename), () => {});
            fileStore.delete(code);
        }
    }, 24 * 60 * 60 * 1000);
    
    res.json({ success: true, code });
});

// Retrieve endpoint
app.get('/api/retrieve/:code', (req, res) => {
    const { code } = req.params;
    const fileData = fileStore.get(code);
    
    if (!fileData) {
        return res.status(404).json({ error: 'Code not found or expired' });
    }
    
    if (Date.now() > fileData.expiresAt) {
        fs.unlink(path.join('./uploads', fileData.filename), () => {});
        fileStore.delete(code);
        return res.status(404).json({ error: 'Code expired' });
    }
    
    res.json({
        success: true,
        file: {
            name: fileData.originalName,
            size: fileData.size,
            type: fileData.mimetype,
            uploadedAt: fileData.uploadedAt
        }
    });
});

// Download endpoint
app.get('/api/download/:code', (req, res) => {
    const { code } = req.params;
    const fileData = fileStore.get(code);
    
    if (!fileData || Date.now() > fileData.expiresAt) {
        return res.status(404).json({ error: 'Not found or expired' });
    }
    
    const filepath = path.join(__dirname, 'uploads', fileData.filename);
    res.download(filepath, fileData.originalName);
});

// Health check
app.get('/api/health', (req, res) => {
    res.json({ status: 'ok', storedFiles: fileStore.size });
});

app.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
});
