(() => {
    'use strict';

    const textBox      = document.getElementById('text-box');
    const voiceSelect   = document.getElementById('voice-select');
    const rateInput     = document.getElementById('rate');
    const pitchInput    = document.getElementById('pitch');
    const rateValue     = document.getElementById('rate-value');
    const pitchValue    = document.getElementById('pitch-value');
    const sttBtn        = document.getElementById('start-stt');
    const ttsBtn        = document.getElementById('start-tts');
    const downloadBtn   = document.getElementById('download-btn');
    const clearBtn       = document.getElementById('clear-btn');
    const copyBtn        = document.getElementById('copy-btn');
    const charCount      = document.getElementById('char-count');
    const waveform       = document.getElementById('waveform');
    const statusRow       = document.getElementById('status-row');
    const statusText      = document.getElementById('status-text');

    let statusTimer = null;
    function setStatus(message, tone = 'info', persist = false) {
        clearTimeout(statusTimer);
        if (!message) { statusRow.hidden = true; return; }
        statusText.textContent = message;
        statusRow.hidden = false;
        statusRow.style.borderColor = tone === 'error' ? 'var(--danger)' : 'var(--border)';
        statusText.style.color = tone === 'error' ? 'var(--danger)' : 'var(--text-dim)';
        if (!persist) {
            statusTimer = setTimeout(() => { statusRow.hidden = true; }, 4000);
        }
    }

    function setWaveState(state) { waveform.dataset.state = state; }

    function updateCharCount() { charCount.textContent = textBox.value.length; }
    textBox.addEventListener('input', updateCharCount);
    updateCharCount();

    // ---------- Voice list ----------
    let voices = [];
    function populateVoices() {
        voices = window.speechSynthesis.getVoices().sort((a, b) => a.name.localeCompare(b.name));
        if (!voices.length) return;
        voiceSelect.innerHTML = voices
            .map((v, i) => `<option value="${i}">${v.name} (${v.lang})</option>`)
            .join('');
        const preferred = voices.findIndex(v => v.lang === 'en-US' && v.default);
        if (preferred > -1) voiceSelect.value = preferred;
    }
    if ('speechSynthesis' in window) {
        window.speechSynthesis.onvoiceschanged = populateVoices;
        populateVoices();
    } else {
        voiceSelect.innerHTML = '<option>Not supported in this browser</option>';
    }

    // ---------- Rate / pitch sliders ----------
    rateInput.addEventListener('input', () => { rateValue.textContent = `${parseFloat(rateInput.value).toFixed(1)}×`; });
    pitchInput.addEventListener('input', () => { pitchValue.textContent = parseFloat(pitchInput.value).toFixed(1); });

    function buildUtterance() {
        const utter = new SpeechSynthesisUtterance(textBox.value);
        utter.voice = voices[voiceSelect.value] || null;
        utter.rate = parseFloat(rateInput.value);
        utter.pitch = parseFloat(pitchInput.value);
        return utter;
    }

    // ---------- Text to speech ----------
    ttsBtn.addEventListener('click', () => {
        if (!('speechSynthesis' in window)) {
            setStatus('Speech synthesis isn\u2019t supported in this browser.', 'error');
            return;
        }
        if (!textBox.value.trim()) {
            setStatus('Type or dictate something first.', 'error');
            return;
        }
        window.speechSynthesis.cancel();
        const utter = buildUtterance();
        utter.onstart = () => setWaveState('speaking');
        utter.onend = () => setWaveState('idle');
        utter.onerror = () => { setWaveState('idle'); setStatus('Playback was interrupted.', 'error'); };
        window.speechSynthesis.speak(utter);
    });

    // ---------- Speech to text ----------
    const SpeechRecognitionAPI = window.SpeechRecognition || window.webkitSpeechRecognition;
    let recognition = null;
    let isRecording = false;

    if (SpeechRecognitionAPI) {
        recognition = new SpeechRecognitionAPI();
        recognition.continuous = true;
        recognition.interimResults = false;
        recognition.lang = 'en-US';

        recognition.onstart = () => {
            isRecording = true;
            sttBtn.querySelector('.btn-label').textContent = 'Stop recording';
            sttBtn.querySelector('.btn-icon').textContent = '🛑';
            sttBtn.classList.add('recording');
            setWaveState('listening');
        };

        recognition.onend = () => {
            isRecording = false;
            sttBtn.querySelector('.btn-label').textContent = 'Record';
            sttBtn.querySelector('.btn-icon').textContent = '🎤';
            sttBtn.classList.remove('recording');
            setWaveState('idle');
        };

        recognition.onerror = (event) => {
            const messages = {
                'not-allowed': 'Microphone access was blocked. Allow it in your browser settings to dictate.',
                'no-speech': 'Didn\u2019t catch that — try speaking again.',
                'audio-capture': 'No microphone was found.',
            };
            setStatus(messages[event.error] || `Speech recognition error: ${event.error}`, 'error');
        };

        recognition.onresult = (event) => {
            let transcript = event.results[event.results.length - 1][0].transcript;
            let text = transcript.toLowerCase().trim();

            if (text.includes('delete last')) {
                let sentences = textBox.value.trim().split('. ');
                sentences.pop();
                textBox.value = sentences.join('. ') + (sentences.length > 0 ? '. ' : '');
                updateCharCount();
                return;
            }

            const maps = [
                { r: /\bquestion mark\b/g, s: '?' },
                { r: /\bcomma\b/g, s: ',' },
                { r: /\bexclamation (mark|point)\b/g, s: '!' },
                { r: /\b(period|full stop)\b/g, s: '.' },
                { r: /\bnew line\b/g, s: '\n' },
            ];
            maps.forEach(m => { text = text.replace(m.r, m.s); });
            text = text.replace(/\s+([?.!,])/g, '$1');
            text = text.charAt(0).toUpperCase() + text.slice(1);

            const gap = (textBox.value.length > 0 && !textBox.value.endsWith('\n')) ? ' ' : '';
            textBox.value += gap + text;
            updateCharCount();
        };

        sttBtn.addEventListener('click', () => {
            if (!isRecording) {
                try { recognition.start(); } catch (e) { /* already started */ }
            } else {
                recognition.stop();
            }
        });
    } else {
        sttBtn.disabled = true;
        sttBtn.querySelector('.btn-label').textContent = 'Recording not supported';
        setStatus('This browser doesn\u2019t support speech recognition. Try Chrome or Edge.', 'error', true);
    }

    // ---------- Download audio (tab-audio capture) ----------
    let isCapturing = false;

    downloadBtn.addEventListener('click', async () => {
        if (isCapturing) return;

        if (!textBox.value.trim()) {
            setStatus('Type or dictate something first.', 'error');
            return;
        }
        if (!navigator.mediaDevices || !navigator.mediaDevices.getDisplayMedia) {
            setStatus('Audio download needs tab-capture support — try Chrome or Edge on desktop.', 'error', true);
            return;
        }

        let displayStream;
        try {
            setStatus('Choose "This tab" and enable "Share tab audio" in the prompt…', 'info', true);
            displayStream = await navigator.mediaDevices.getDisplayMedia({ video: true, audio: true });
        } catch (err) {
            setStatus('Screen-share permission was cancelled, so there\u2019s no audio to capture.', 'error');
            return;
        }

        const audioTracks = displayStream.getAudioTracks();
        displayStream.getVideoTracks().forEach(t => t.stop());

        if (!audioTracks.length) {
            displayStream.getTracks().forEach(t => t.stop());
            setStatus('No tab audio was shared — make sure "Share tab audio" is checked.', 'error', true);
            return;
        }

        const audioStream = new MediaStream(audioTracks);
        const chunks = [];
        let recorder;
        try {
            recorder = new MediaRecorder(audioStream);
        } catch (err) {
            displayStream.getTracks().forEach(t => t.stop());
            setStatus('This browser can\u2019t record the captured audio.', 'error');
            return;
        }

        recorder.ondataavailable = (e) => { if (e.data.size > 0) chunks.push(e.data); };

        recorder.onstop = () => {
            displayStream.getTracks().forEach(t => t.stop());
            isCapturing = false;
            downloadBtn.classList.remove('recording');
            downloadBtn.querySelector('.btn-label').textContent = 'Download audio';
            setWaveState('idle');

            if (!chunks.length) {
                setStatus('No audio was captured — please try again.', 'error');
                return;
            }
            const blob = new Blob(chunks, { type: 'audio/webm' });
            const url = URL.createObjectURL(blob);
            const a = document.createElement('a');
            const words = textBox.value.trim().split(/\s+/).slice(0, 4).join('-').replace(/[^\w-]/g, '') || 'voice-studio';
            a.href = url;
            a.download = `${words}.webm`;
            document.body.appendChild(a);
            a.click();
            a.remove();
            setTimeout(() => URL.revokeObjectURL(url), 2000);
            setStatus('Audio downloaded.', 'info');
        };

        // If the user stops sharing from the browser's own UI, wrap up gracefully.
        audioTracks[0].addEventListener('ended', () => { if (recorder.state !== 'inactive') recorder.stop(); });

        isCapturing = true;
        downloadBtn.classList.add('recording');
        downloadBtn.querySelector('.btn-label').textContent = 'Recording…';
        setStatus('Recording started — playing your text now.', 'info', true);
        setWaveState('recording');
        recorder.start();

        window.speechSynthesis.cancel();
        const utter = buildUtterance();
        utter.onend = () => { if (recorder.state !== 'inactive') recorder.stop(); };
        utter.onerror = () => { if (recorder.state !== 'inactive') recorder.stop(); };
        // Small delay so the recorder is fully live before speech starts.
        setTimeout(() => window.speechSynthesis.speak(utter), 250);
    });

    // ---------- Utilities ----------
    clearBtn.addEventListener('click', () => {
        textBox.value = '';
        updateCharCount();
        textBox.focus();
    });

    copyBtn.addEventListener('click', async () => {
        if (!textBox.value) { setStatus('Nothing to copy yet.', 'error'); return; }
        try {
            await navigator.clipboard.writeText(textBox.value);
            const label = copyBtn.querySelector('.btn-label');
            const old = label.textContent;
            label.textContent = 'Copied!';
            setTimeout(() => { label.textContent = old; }, 1800);
        } catch (err) {
            setStatus('Couldn\u2019t copy — your browser may be blocking clipboard access.', 'error');
        }
    });
})();