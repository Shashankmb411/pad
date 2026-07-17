// ========================
// ESP32-CAM Fire & Freeze Detector
// Computer Vision in Browser
// ========================

let isRunning = false;
let videoFeed = document.getElementById('videoFeed');
let canvasOverlay = document.getElementById('canvasOverlay');
let ctx = canvasOverlay.getContext('2d');
let streamBox = document.getElementById('streamBox');
let fireBadge = document.getElementById('fireBadge');
let freezeBadge = document.getElementById('freezeBadge');

// Status elements
let streamDot = document.getElementById('streamDot');
let fireDot = document.getElementById('fireDot');
let freezeDot = document.getElementById('freezeDot');
let streamStatus = document.getElementById('streamStatus');
let fireStatus = document.getElementById('fireStatus');
let freezeStatus = document.getElementById('freezeStatus');

// Settings
let streamUrlInput = document.getElementById('streamUrl');
let fireThresholdInput = document.getElementById('fireThreshold');
let freezeTimeoutInput = document.getElementById('freezeTimeout');

// Detection state
let lastFrameData = null;
let lastFrameTime = 0;
let freezeTimer = null;
let fireDetected = false;
let freezeDetected = false;
let frameCount = 0;
let analysisCanvas = document.createElement('canvas');
let analysisCtx = analysisCanvas.getContext('2d', { willReadFrequently: true });

// Notification state
let notificationsEnabled = false;

// Update threshold displays
fireThresholdInput.addEventListener('input', () => {
    document.getElementById('fireThresholdVal').textContent = fireThresholdInput.value + '%';
});
freezeTimeoutInput.addEventListener('input', () => {
    document.getElementById('freezeTimeoutVal').textContent = freezeTimeoutInput.value + 's';
});

// ========================
// Logging
// ========================
function log(message, type = 'info') {
    const logBox = document.getElementById('logBox');
    const entry = document.createElement('div');
    entry.className = `log-entry ${type}`;
    const time = new Date().toLocaleTimeString();
    entry.textContent = `[${time}] ${message}`;
    logBox.insertBefore(entry, logBox.firstChild);
    // Keep only last 50 entries
    while (logBox.children.length > 50) {
        logBox.removeChild(logBox.lastChild);
    }
}

function clearLog() {
    document.getElementById('logBox').innerHTML = '<div class="log-entry info">Log cleared.</div>';
}

// ========================
// Notification System
// ========================
async function requestNotificationPermission() {
    if (!('Notification' in window)) {
        alert('This browser does not support notifications.');
        return;
    }
    
    const permission = await Notification.requestPermission();
    if (permission === 'granted') {
        notificationsEnabled = true;
        log('Notifications enabled!', 'info');
        new Notification('🔥 Fire Detector', {
            body: 'Notifications are now active. You will be alerted on fire/blast or camera freeze.',
            icon: 'https://cdn-icons-png.flaticon.com/512/785/785116.png'
        });
    } else {
        log('Notification permission denied.', 'info');
    }
}

function sendNotification(title, body, type = 'fire') {
    if (!notificationsEnabled) return;
    
    const icon = type === 'fire' 
        ? 'https://cdn-icons-png.flaticon.com/512/785/785116.png'
        : 'https://cdn-icons-png.flaticon.com/512/2312/2311524.png';
    
    new Notification(title, {
        body: body,
        icon: icon,
        requireInteraction: true,
        tag: type // prevents duplicate notifications
    });
    
    // Also try to vibrate if on mobile
    if (navigator.vibrate) {
        navigator.vibrate(type === 'fire' ? [500, 200, 500, 200, 500] : [300, 100, 300]);
    }
}

// ========================
// Stream Handling
// ========================
function startDetection() {
    if (isRunning) return;
    
    let url = streamUrlInput.value.trim();
    if (!url) {
        alert('Please enter the ESP32-CAM stream URL (e.g., http://192.168.1.45/stream)');
        return;
    }
    
    if (!url.includes('/stream')) {
        url = url.replace(/\/$/, '') + '/stream';
    }
    
    isRunning = true;
    log('Starting detection...', 'info');
    
    videoFeed.src = url;
    videoFeed.onload = () => {
        streamDot.classList.add('active');
        streamStatus.textContent = 'Stream Online';
        log('Stream connected successfully.', 'info');
        
        // Set canvas size to match video
        canvasOverlay.width = videoFeed.clientWidth;
        canvasOverlay.height = videoFeed.clientHeight;
        analysisCanvas.width = 320; // Downscale for performance
        analysisCanvas.height = 240;
        
        lastFrameTime = Date.now();
        requestAnimationFrame(analyzeFrame);
    };
    
    videoFeed.onerror = () => {
        log('Stream connection failed. Check IP address.', 'info');
        stopDetection();
    };
}

function stopDetection() {
    isRunning = false;
    videoFeed.src = '';
    streamDot.classList.remove('active');
    streamStatus.textContent = 'Stream Offline';
    fireDot.className = 'status-dot';
    fireStatus.textContent = 'No Fire';
    freezeDot.className = 'status-dot';
    freezeStatus.textContent = 'Camera Active';
    streamBox.classList.remove('alert', 'freeze');
    fireBadge.style.display = 'none';
    freezeBadge.style.display = 'none';
    clearTimeout(freezeTimer);
    lastFrameData = null;
    log('Detection stopped.', 'info');
}

// ========================
// Fire/Blast Detection Algorithm
// ========================
function detectFire(imageData) {
    const data = imageData.data;
    const width = imageData.width;
    const height = imageData.height;
    const totalPixels = width * height;
    
    let firePixels = 0;
    let brightPixels = 0;
    let redPixels = 0;
    let orangePixels = 0;
    let yellowPixels = 0;
    
    // Fire color detection: High Red, Moderate Green, Low Blue
    // Blast = very bright white/yellow flash
    for (let i = 0; i < data.length; i += 4) {
        const r = data[i];
        const g = data[i + 1];
        const b = data[i + 2];
        const brightness = (r + g + b) / 3;
        
        // Brightness threshold for blast detection
        if (brightness > 200) brightPixels++;
        
        // Fire color rules
        // Red fire: R high, G low-med, B low
        if (r > 150 && g < 100 && b < 80 && r > g + 30) {
            redPixels++;
        }
        // Orange fire: R high, G med, B low
        else if (r > 140 && g > 60 && g < 150 && b < 60 && r > g) {
            orangePixels++;
        }
        // Yellow/white blast: R high, G high, B low-med
        else if (r > 180 && g > 150 && b < 120 && Math.abs(r - g) < 60) {
            yellowPixels++;
        }
    }
    
    firePixels = redPixels + orangePixels + yellowPixels;
    const firePercentage = (firePixels / totalPixels) * 100;
    const blastPercentage = (brightPixels / totalPixels) * 100;
    const threshold = parseInt(fireThresholdInput.value);
    
    // Fire detected if fire pixels exceed threshold
    // OR blast detected if very bright flash
    const isFire = firePercentage > threshold;
    const isBlast = blastPercentage > 25; // Sudden bright flash
    
    return {
        fire: isFire || isBlast,
        blast: isBlast,
        firePercentage: firePercentage.toFixed(1),
        blastPercentage: blastPercentage.toFixed(1),
        redPixels,
        orangePixels,
        yellowPixels
    };
}

// ========================
// Freeze Detection (Camera Not Moving)
// ========================
function detectFreeze(currentImageData) {
    if (!lastFrameData) {
        lastFrameData = new Uint8ClampedArray(currentImageData.data);
        return false;
    }
    
    const current = currentImageData.data;
    const previous = lastFrameData;
    let diffPixels = 0;
    const threshold = 30; // Pixel difference threshold
    const sampleStep = 16; // Check every 16th pixel for performance
    
    for (let i = 0; i < current.length; i += 4 * sampleStep) {
        const diff = Math.abs(current[i] - previous[i]) +
                     Math.abs(current[i + 1] - previous[i + 1]) +
                     Math.abs(current[i + 2] - previous[i + 2]);
        if (diff > threshold * 3) {
            diffPixels++;
        }
    }
    
    const totalSamples = current.length / (4 * sampleStep);
    const motionPercentage = (diffPixels / totalSamples) * 100;
    
    // Update last frame data
    lastFrameData = new Uint8ClampedArray(current);
    lastFrameTime = Date.now();
    
    // If motion is very low, camera might be frozen
    return motionPercentage < 1.0; // Less than 1% pixel change
}

// ========================
// Main Analysis Loop
// ========================
function analyzeFrame() {
    if (!isRunning) return;
    
    // Check if video is ready
    if (videoFeed.readyState < 2) {
        requestAnimationFrame(analyzeFrame);
        return;
    }
    
    frameCount++;
    
    // Draw current frame to analysis canvas (downscaled for performance)
    analysisCtx.drawImage(videoFeed, 0, 0, analysisCanvas.width, analysisCanvas.height);
    const imageData = analysisCtx.getImageData(0, 0, analysisCanvas.width, analysisCanvas.height);
    
    // Detect fire/blast
    const fireResult = detectFire(imageData);
    
    // Detect freeze
    const isFrozen = detectFreeze(imageData);
    
    // Handle fire detection
    if (fireResult.fire && !fireDetected) {
        fireDetected = true;
        fireDot.className = 'status-dot fire';
        fireStatus.textContent = fireResult.blast ? '🔥 BLAST DETECTED!' : '🔥 FIRE DETECTED!';
        streamBox.classList.add('alert');
        fireBadge.style.display = 'block';
        fireBadge.textContent = fireResult.blast ? '💥 BLAST DETECTED!' : '🔥 FIRE DETECTED!';
        
        log(`ALERT: ${fireResult.blast ? 'BLAST' : 'FIRE'} detected! ` +
            `(Fire: ${fireResult.firePercentage}%, Bright: ${fireResult.blastPercentage}%)`, 'fire');
        
        sendNotification(
            fireResult.blast ? '💥 BLAST DETECTED!' : '🔥 FIRE DETECTED!',
            `ESP32-CAM detected ${fireResult.blast ? 'a blast/explosion' : 'fire'} at ${new Date().toLocaleTimeString()}`,
            'fire'
        );
        
        // Draw fire zones on overlay
        drawFireOverlay(fireResult);
    } else if (!fireResult.fire && fireDetected) {
        fireDetected = false;
        fireDot.className = 'status-dot';
        fireStatus.textContent = 'No Fire';
        streamBox.classList.remove('alert');
        fireBadge.style.display = 'none';
        ctx.clearRect(0, 0, canvasOverlay.width, canvasOverlay.height);
        log('Fire/blast cleared.', 'info');
    }
    
    // Handle freeze detection
    const freezeTimeout = parseInt(freezeTimeoutInput.value) * 1000;
    
    if (isFrozen && !freezeDetected) {
        // Start freeze timer
        if (!freezeTimer) {
            freezeTimer = setTimeout(() => {
                freezeDetected = true;
                freezeDot.className = 'status-dot freeze';
                freezeStatus.textContent = '⚠️ CAMERA FROZEN!';
                streamBox.classList.add('freeze');
                freezeBadge.style.display = 'block';
                
                log(`ALERT: Camera has not moved for ${freezeTimeout/1000} seconds!`, 'freeze');
                
                sendNotification(
                    '❄️ Camera Frozen!',
                    `ESP32-CAM has not detected movement for ${freezeTimeout/1000} seconds. Check camera status.`,
                    'freeze'
                );
            }, freezeTimeout);
        }
    } else if (!isFrozen) {
        // Camera is moving, clear freeze state
        if (freezeTimer) {
            clearTimeout(freezeTimer);
            freezeTimer = null;
        }
        if (freezeDetected) {
            freezeDetected = false;
            freezeDot.className = 'status-dot';
            freezeStatus.textContent = 'Camera Active';
            streamBox.classList.remove('freeze');
            freezeBadge.style.display = 'none';
            log('Camera movement resumed.', 'info');
        }
    }
    
    // Update stream status periodically
    if (frameCount % 30 === 0) {
        streamStatus.textContent = `Stream Online (${frameCount} frames)`;
    }
    
    requestAnimationFrame(analyzeFrame);
}

// ========================
// Visual Overlay for Fire Zones
// ========================
function drawFireOverlay(fireResult) {
    // Clear previous overlay
    ctx.clearRect(0, 0, canvasOverlay.width, canvasOverlay.height);
    
    // Draw warning rectangles (simplified - full frame warning)
    ctx.strokeStyle = 'rgba(255, 50, 50, 0.8)';
    ctx.lineWidth = 4;
    ctx.strokeRect(10, 10, canvasOverlay.width - 20, canvasOverlay.height - 20);
    
    // Add text
    ctx.fillStyle = 'rgba(255, 50, 50, 0.9)';
    ctx.font = 'bold 20px Arial';
    ctx.fillText('FIRE DETECTED', 20, 40);
}

// ========================
// Service Worker for Background Notifications
// ========================
if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('sw.js')
        .then(reg => console.log('Service Worker registered'))
        .catch(err => console.log('Service Worker registration failed:', err));
}
