// --- Service Workerの登録 (PWA・オフライン対応) ---
if ('serviceWorker' in navigator) {
	window.addEventListener('load', () => {
		navigator.serviceWorker
			.register('./sw.js')
			.then((registration) => {
				console.log('ServiceWorker registration successful');
			})
			.catch((err) => {
				console.log('ServiceWorker registration failed: ', err);
			});
	});
}

// --- Audio Nodes ---
let audioCtx, oscillator, gainNode, filterNode;
let bellFilter, formant1, formant2;
let streamDestination,
	mediaRecorder,
	recordedChunks = [];

let isInitialized = false,
	isPlaying = false,
	isMicInitialized = false;
let analyser, currentStream, microphone;

// --- State ---
let currentEngine = 'real';
let inputMode = 'touch',
	slideMode = 'fixed',
	lipMode = 'standard',
	lipDir = 'normal';
let useTouchPressure = false,
	useYVol = false,
	useVibration = true;
let recordTrigger = 'double';
let isRecording = false;

const baseFundamental = 58.27;
let currentPartialNum = 4;
let currentFreq = baseFundamental * currentPartialNum;

let lastLipTouchY = null;
let partialAccumulator = 0;
let maxSafeFreq = 22000;

const partialNames = [
	'',
	'Bb1',
	'Bb2',
	'F3',
	'Bb3',
	'D4',
	'F4',
	'Ab4',
	'Bb4',
	'C5',
	'D5',
	'Eb5',
	'F5',
	'G5',
	'Ab5',
	'Bb5',
	'C6',
];
const maxPartialIndex = partialNames.length - 1;

const dom = {
	startOverlay: document.getElementById('start-overlay'),
	settingsOverlay: document.getElementById('settings-overlay'),
	openSettingsBtn: document.getElementById('open-settings-btn'),
	closeSettingsBtn: document.getElementById('close-settings-btn'),
	recordBtn: document.getElementById('record-btn'),
	engineSelect: document.getElementById('engine-select'),
	modeSelect: document.getElementById('mode-select'),
	slideModeSelect: document.getElementById('slide-mode-select'),
	lipModeSelect: document.getElementById('lip-mode-select'),
	lipDirSelect: document.getElementById('lip-dir-select'),
	recordTriggerSelect: document.getElementById('record-trigger-select'),
	touchPressureSelect: document.getElementById('touch-pressure-select'),
	vibrationSelect: document.getElementById('vibration-select'),
	yVolSelect: document.getElementById('y-vol-select'),
	micWrapper: document.getElementById('mic-settings-wrapper'),
	proWrapper: document.getElementById('pro-settings-wrapper'),
	micSelect: document.getElementById('mic-select'),
	playScreen: document.getElementById('play-screen'),
	guidesContainer: document.getElementById('guides-container'),
	lipZone: document.getElementById('lip-zone'),
	statusNote: document.getElementById('status-note'),
	statusMode: document.getElementById('status-mode'),
	statusEngine: document.getElementById('status-engine'),
	simpleVol: document.getElementById('simple-vol'),
	lipSens: document.getElementById('lip-sens'),
	micSens: document.getElementById('mic-sens'),
};

const hasTouch = 'ontouchstart' in window || navigator.maxTouchPoints > 0;
if (!hasTouch) {
	dom.touchPressureSelect.disabled = true;
	document.getElementById('touch-pressure-wrapper').style.opacity = '0.3';
}

const hasVibrate = 'vibrate' in navigator;
if (!hasVibrate) {
	dom.vibrationSelect.disabled = true;
	document.getElementById('vibration-wrapper').style.opacity = '0.3';
	useVibration = false;
}

// --- ローカルストレージ処理 ---
function saveSettings() {
	const settings = {
		engine: currentEngine,
		mode: inputMode,
		simpleVol: dom.simpleVol.value,
		recordTrigger: dom.recordTriggerSelect.value,
		vibration: dom.vibrationSelect.value,
		touchPressure: dom.touchPressureSelect.value,
		micSens: dom.micSens.value,
		slideMode: slideMode,
		lipMode: lipMode,
		lipDir: lipDir,
		lipSens: dom.lipSens.value,
		yVol: dom.yVolSelect.value,
	};
	if (dom.micSelect.value) settings.micId = dom.micSelect.value;
	localStorage.setItem('vTromboneSettings', JSON.stringify(settings));
}

function loadSettings() {
	const saved = localStorage.getItem('vTromboneSettings');
	if (saved) {
		try {
			const s = JSON.parse(saved);
			if (s.engine) {
				currentEngine = s.engine;
				dom.engineSelect.value = s.engine;
			}
			if (s.mode) {
				inputMode = s.mode;
				dom.modeSelect.value = s.mode;
			}
			if (s.simpleVol) {
				dom.simpleVol.value = s.simpleVol;
				document.getElementById('val-simple-vol').innerText =
					s.simpleVol;
			}
			if (s.recordTrigger) {
				recordTrigger = s.recordTrigger;
				dom.recordTriggerSelect.value = s.recordTrigger;
			}
			if (s.vibration && hasVibrate) {
				dom.vibrationSelect.value = s.vibration;
				useVibration = s.vibration === 'on';
			}
			if (s.touchPressure && hasTouch) {
				dom.touchPressureSelect.value = s.touchPressure;
				useTouchPressure = s.touchPressure === 'on';
			}
			if (s.micSens) {
				dom.micSens.value = s.micSens;
				document.getElementById('val-mic-sens').innerText = s.micSens;
			}
			if (s.slideMode) {
				slideMode = s.slideMode;
				dom.slideModeSelect.value = s.slideMode;
			}
			if (s.lipMode) {
				lipMode = s.lipMode;
				dom.lipModeSelect.value = s.lipMode;
			}
			if (s.lipDir) {
				lipDir = s.lipDir;
				dom.lipDirSelect.value = s.lipDir;
			}
			if (s.lipSens) {
				dom.lipSens.value = s.lipSens;
				document.getElementById('val-lip-sens').innerText = s.lipSens;
			}
			if (s.yVol) {
				dom.yVolSelect.value = s.yVol;
				useYVol = s.yVol === 'on';
			}
		} catch (e) {
			console.error('設定読み込みエラー', e);
		}
	}
}

function drawGuides() {
	const hContainer = document.getElementById('harmonic-guides');
	const pContainer = document.getElementById('pos-guides');
	hContainer.innerHTML = '';
	pContainer.innerHTML = '';

	if (lipMode === 'standard') {
		for (let i = 1; i <= 7; i++) {
			const line = document.createElement('div');
			line.className = 'harmonic-marker';
			line.style.bottom = `${(i / 8) * 100}%`;
			hContainer.appendChild(line);
		}
	}
	for (let i = 0; i < 7; i++) {
		const line = document.createElement('div');
		line.className = 'slide-marker';
		let leftPercent =
			slideMode === 'fixed'
				? (i / 6) * 100
				: ((Math.pow(2, i / 12) - 1) / (Math.pow(2, 6 / 12) - 1)) * 100;
		line.style.left = `${leftPercent}%`;
		pContainer.appendChild(line);
	}
}

function createBrassWave(ctx) {
	const real = new Float32Array([
		0, 1.0, 0.9, 0.8, 0.75, 0.65, 0.6, 0.5, 0.45, 0.35, 0.3, 0.25, 0.2,
		0.15, 0.1, 0.05,
	]);
	const imag = new Float32Array(real.length);
	return ctx.createPeriodicWave(real, imag);
}

function buildAudioEngine() {
	if (!audioCtx) return;

	if (oscillator) {
		oscillator.stop();
		oscillator.disconnect();
	}
	if (bellFilter) bellFilter.disconnect();
	if (formant1) formant1.disconnect();
	if (formant2) formant2.disconnect();
	if (filterNode) filterNode.disconnect();
	if (gainNode) gainNode.disconnect();

	if (!streamDestination) {
		streamDestination = audioCtx.createMediaStreamDestination();
		mediaRecorder = new MediaRecorder(streamDestination.stream);
		mediaRecorder.ondataavailable = (e) => {
			if (e.data.size > 0) recordedChunks.push(e.data);
		};
		mediaRecorder.onstop = () => {
			let ext = 'webm';
			if (
				!MediaRecorder.isTypeSupported('audio/webm') &&
				MediaRecorder.isTypeSupported('audio/mp4')
			)
				ext = 'mp4';
			const blob = new Blob(recordedChunks);
			const url = URL.createObjectURL(blob);
			const a = document.createElement('a');
			a.href = url;
			a.download = `trombone_rec_${new Date().getTime()}.${ext}`;
			a.click();
			URL.revokeObjectURL(url);
		};
	}

	const oldGain = gainNode ? gainNode.gain.value : 0;
	oscillator = audioCtx.createOscillator();
	filterNode = audioCtx.createBiquadFilter();
	filterNode.type = 'lowpass';

	gainNode = audioCtx.createGain();
	gainNode.gain.value = oldGain;

	if (currentEngine === 'old-real') {
		oscillator.setPeriodicWave(createBrassWave(audioCtx));
		bellFilter = audioCtx.createBiquadFilter();
		bellFilter.type = 'peaking';
		bellFilter.frequency.value = 900;
		bellFilter.Q.value = 1.0;
		bellFilter.gain.value = 8.0;
		filterNode.Q.value = 0.6;
		oscillator.connect(bellFilter);
		bellFilter.connect(filterNode);
	} else if (currentEngine === 'real') {
		oscillator.type = 'sawtooth';
		formant1 = audioCtx.createBiquadFilter();
		formant1.type = 'peaking';
		formant1.frequency.value = 450;
		formant1.Q.value = 1.0;
		formant1.gain.value = 4.5;
		formant2 = audioCtx.createBiquadFilter();
		formant2.type = 'peaking';
		formant2.frequency.value = 1000;
		formant2.Q.value = 1.2;
		formant2.gain.value = 5.0;
		filterNode.Q.value = 0.8;
		oscillator.connect(formant1);
		formant1.connect(formant2);
		formant2.connect(filterNode);
	} else {
		oscillator.type = 'sawtooth';
		filterNode.Q.value = 0.5;
		oscillator.connect(filterNode);
	}

	filterNode.connect(gainNode);
	gainNode.connect(audioCtx.destination);
	gainNode.connect(streamDestination);

	oscillator.frequency.value = currentFreq;
	oscillator.start();
}

function initSystem(e) {
	if (isInitialized) return;
	isInitialized = true;

	const AudioContext = window.AudioContext || window.webkitAudioContext;
	audioCtx = new AudioContext();
	if (audioCtx.state === 'suspended') audioCtx.resume();

	maxSafeFreq = Math.min(audioCtx.sampleRate / 2 - 100, 22000);

	buildAudioEngine();

	if (inputMode === 'mic' && !isMicInitialized) {
		setupMicrophone().catch(() => {});
	}

	isPlaying = true;
	dom.startOverlay.style.display = 'none';
	requestAnimationFrame(updateLoop);
	handleResize();
	handleInput(e);
}

async function setupMicrophone(deviceId = null) {
	if (!audioCtx) return;
	if (currentStream) currentStream.getTracks().forEach((t) => t.stop());

	const audioSettings = {
		echoCancellation: false,
		autoGainControl: false,
		noiseSuppression: false,
	};
	if (deviceId) audioSettings.deviceId = { exact: deviceId };
	const constraints = { audio: audioSettings };

	try {
		currentStream = await navigator.mediaDevices.getUserMedia(constraints);
		if (!analyser) {
			analyser = audioCtx.createAnalyser();
			analyser.fftSize = 512;
		}
		if (microphone) microphone.disconnect();
		microphone = audioCtx.createMediaStreamSource(currentStream);
		microphone.connect(analyser);
		isMicInitialized = true;

		const devices = await navigator.mediaDevices.enumerateDevices();
		dom.micSelect.innerHTML = devices
			.filter((d) => d.kind === 'audioinput')
			.map(
				(d) =>
					`<option value="${d.deviceId}" ${d.deviceId === deviceId ? 'selected' : ''}>${d.label || 'マイク'}</option>`,
			)
			.join('');
	} catch (e) {
		alert('マイクのアクセスに失敗しました。');
		dom.modeSelect.value = 'touch';
		inputMode = 'touch';
		updateUIStates();
		saveSettings();
	}
}

// --- 録音制御 ---
let lastRecordTapTime = 0;
function toggleRecording() {
	if (!mediaRecorder) return;
	if (isRecording) {
		mediaRecorder.stop();
		isRecording = false;
		dom.recordBtn.classList.remove('recording');
	} else {
		recordedChunks = [];
		mediaRecorder.start();
		isRecording = true;
		dom.recordBtn.classList.add('recording');
	}
}

function handleRecordBtnClick(e) {
	e.preventDefault();
	e.stopPropagation();
	if (!isInitialized) return;

	if (recordTrigger === 'single') {
		toggleRecording();
	} else {
		const now = Date.now();
		if (now - lastRecordTapTime < 350) {
			toggleRecording();
			lastRecordTapTime = 0;
		} else {
			lastRecordTapTime = now;
		}
	}
}
dom.recordBtn.addEventListener('mousedown', handleRecordBtnClick);
dom.recordBtn.addEventListener('touchstart', handleRecordBtnClick, {
	passive: false,
});

function changePartial(newVal) {
	let clamped = Math.max(1, Math.min(maxPartialIndex, newVal));
	if (clamped !== currentPartialNum) {
		currentPartialNum = clamped;
		if (useVibration && navigator.vibrate) navigator.vibrate(15);
		dom.statusNote.innerText = `音階: ${partialNames[currentPartialNum]}`;
	}
	return clamped;
}

function updateLoop() {
	if (!isPlaying) return;
	requestAnimationFrame(updateLoop);

	if (inputMode === 'touch' || !isMicInitialized) return;

	const data = new Uint8Array(analyser.frequencyBinCount);
	analyser.getByteTimeDomainData(data);
	let sum = 0;
	for (let i = 0; i < data.length; i++) {
		const v = (data[i] - 128) / 128;
		sum += v * v;
	}
	const rms = Math.sqrt(sum / data.length);
	const sens = parseFloat(dom.micSens.value);
	let vol = Math.min(1.0, rms * sens);
	if (vol < 0.05) vol = 0;

	let currentVol = vol * 0.8;
	if (currentEngine === 'real') currentVol *= 0.6;
	gainNode.gain.setTargetAtTime(currentVol, audioCtx.currentTime, 0.04);

	let targetCutoff;
	if (currentEngine === 'real') {
		targetCutoff = currentFreq * 1.2 + Math.pow(vol, 1.5) * 14000;
	} else if (currentEngine === 'old-real') {
		targetCutoff = currentFreq * 3.5 + vol * 8000;
	} else {
		targetCutoff = currentFreq * 1.5 + vol * 8000;
	}
	targetCutoff = Math.max(10, Math.min(targetCutoff, maxSafeFreq));
	filterNode.frequency.setTargetAtTime(
		targetCutoff,
		audioCtx.currentTime,
		0.04,
	);
}

function handleStop() {
	if (inputMode === 'touch' && gainNode) {
		gainNode.gain.setTargetAtTime(0, audioCtx.currentTime, 0.05);
	}
}

function handleResize() {
	document.body.style.height = window.innerHeight + 'px';
	if (isInitialized) {
		drawGuides();
		handleStop();
		lastLipTouchY = null;
		partialAccumulator = 0;
	}
}

function handleInput(e) {
	if (!isPlaying || dom.settingsOverlay.style.display === 'flex') return;
	if (audioCtx.state === 'suspended') audioCtx.resume();

	const rect = dom.playScreen.getBoundingClientRect();
	const isTouch = e.touches !== undefined;

	let slideTouch = null;
	let lipTouch = null;

	// 画面幅の1/7をリップゾーンの幅として計算
	const lipWidth = rect.width / 7;

	if (isTouch) {
		for (let i = 0; i < e.touches.length; i++) {
			let t = e.touches[i];
			let relativeX = t.clientX - rect.left;
			if (lipMode === 'pro' && relativeX <= lipWidth) {
				lipTouch = t;
			} else if (!slideTouch && relativeX > lipWidth) {
				slideTouch = t;
			} else if (lipMode !== 'pro' && !slideTouch) {
				slideTouch = t;
			}
		}
	} else {
		if (e.type !== 'mouseup' && e.type !== 'mouseleave') {
			let relativeX = e.clientX - rect.left;
			if (lipMode === 'pro' && relativeX <= lipWidth) {
				lipTouch = e;
			} else {
				slideTouch = e;
			}
		}
	}

	if (lipMode === 'pro') {
		if (lipTouch) {
			let currentY = lipTouch.clientY;
			if (lastLipTouchY !== null) {
				let deltaY = currentY - lastLipTouchY;
				let deltaNorm = -(deltaY / rect.height);
				if (lipDir === 'invert') deltaNorm = -deltaNorm;
				const sens = parseFloat(dom.lipSens.value);
				partialAccumulator += deltaNorm * sens * 8;
				let requestedPartial = currentPartialNum;
				while (partialAccumulator > 1.0) {
					requestedPartial++;
					partialAccumulator -= 1.0;
				}
				while (partialAccumulator < -1.0) {
					requestedPartial--;
					partialAccumulator += 1.0;
				}
				let actualPartial = changePartial(requestedPartial);
				if (actualPartial !== requestedPartial) partialAccumulator = 0;
			}
			lastLipTouchY = currentY;
		} else {
			lastLipTouchY = null;
			partialAccumulator = 0;
		}
	} else if (lipMode === 'standard') {
		if (slideTouch) {
			let y = 1.0 - (slideTouch.clientY - rect.top) / rect.height;
			y = Math.max(0, Math.min(1, y));
			let pIdx = Math.min(7, Math.floor(y * 8));
			changePartial(pIdx + 1);
		}
	}

	if (slideTouch) {
		let xOffset = lipMode === 'pro' ? lipWidth : 0;
		let playWidth = rect.width - xOffset;
		let x = (slideTouch.clientX - rect.left - xOffset) / playWidth;
		x = Math.max(0, Math.min(1, x));
		const baseFreqForPartial = baseFundamental * currentPartialNum;
		if (slideMode === 'fixed') {
			const semitonesDown = x * 6;
			currentFreq = baseFreqForPartial * Math.pow(2, -semitonesDown / 12);
		} else {
			const lengthMultiplier = 1 + (Math.pow(2, 6 / 12) - 1) * x;
			currentFreq = baseFreqForPartial / lengthMultiplier;
		}
		if (oscillator)
			oscillator.frequency.setTargetAtTime(
				currentFreq,
				audioCtx.currentTime,
				0.03,
			);
		if (inputMode === 'touch' && gainNode) {
			let targetVol = parseFloat(dom.simpleVol.value) / 100;
			let brightnessInput = targetVol;
			if (
				useTouchPressure &&
				isTouch &&
				slideTouch.force !== undefined &&
				slideTouch.force > 0
			) {
				let force = slideTouch.force;
				targetVol *= Math.max(0.05, force);
				brightnessInput = force;
			}
			if (useYVol && lipMode === 'pro') {
				let yNorm = 1.0 - (slideTouch.clientY - rect.top) / rect.height;
				yNorm = Math.max(0.05, Math.min(1.0, yNorm));
				targetVol *= yNorm;
				brightnessInput *= yNorm;
			}
			if (currentEngine === 'real') targetVol *= 0.6;
			else if (currentEngine === 'old-real') targetVol *= 0.8;
			gainNode.gain.setTargetAtTime(
				targetVol,
				audioCtx.currentTime,
				0.03,
			);
			let targetCutoff;
			if (currentEngine === 'real') {
				targetCutoff =
					currentFreq * 1.2 + Math.pow(brightnessInput, 1.5) * 12000;
			} else if (currentEngine === 'old-real') {
				targetCutoff = currentFreq * 2.0 + brightnessInput * 8000;
			} else {
				targetCutoff = currentFreq * 1.5 + brightnessInput * 8000;
			}
			targetCutoff = Math.max(10, Math.min(targetCutoff, maxSafeFreq));
			filterNode.frequency.setTargetAtTime(
				targetCutoff,
				audioCtx.currentTime,
				0.03,
			);
		}
	} else {
		handleStop();
	}
}

function updateUIStates() {
	let engineName = 'シンプル';
	if (currentEngine === 'real') engineName = 'リアル';
	else if (currentEngine === 'old-real') engineName = '旧リアル';
	dom.statusEngine.innerText = engineName;
	dom.statusEngine.style.color =
		currentEngine === 'real' ? '#4fc3f7' : '#aaa';
	if (inputMode === 'mic') {
		dom.micWrapper.style.opacity = '1';
		dom.micWrapper.style.pointerEvents = 'auto';
		dom.statusMode.innerText = 'モード: マイク';
	} else {
		dom.micWrapper.style.opacity = '0.3';
		dom.micWrapper.style.pointerEvents = 'none';
		dom.statusMode.innerText = 'モード: タッチ';
		if (gainNode)
			gainNode.gain.setTargetAtTime(0, audioCtx.currentTime, 0.05);
	}
	if (lipMode === 'pro') {
		dom.lipZone.style.display = 'flex';
		dom.lipZone.style.width = 'calc(100% / 7)';
		dom.guidesContainer.style.left = 'calc(100% / 7)';
		dom.guidesContainer.style.width = 'calc(100% * 6 / 7)';
		dom.proWrapper.style.opacity = '1';
		dom.proWrapper.style.pointerEvents = 'auto';
	} else {
		dom.lipZone.style.display = 'none';
		dom.guidesContainer.style.left = '0';
		dom.guidesContainer.style.width = '100%';
		dom.proWrapper.style.opacity = '0.3';
		dom.proWrapper.style.pointerEvents = 'none';
	}
}

window.addEventListener('resize', handleResize);
window.addEventListener('orientationchange', handleResize);
dom.startOverlay.addEventListener('mousedown', initSystem);
dom.startOverlay.addEventListener(
	'touchstart',
	(e) => {
		e.preventDefault();
		initSystem(e);
	},
	{ passive: false },
);
const openSettings = (e) => {
	e.preventDefault();
	e.stopPropagation();
	dom.settingsOverlay.style.display = 'flex';
	handleStop();
};
dom.openSettingsBtn.addEventListener('mousedown', openSettings);
dom.openSettingsBtn.addEventListener('touchstart', openSettings, {
	passive: false,
});
dom.closeSettingsBtn.onclick = () =>
	(dom.settingsOverlay.style.display = 'none');
document.querySelectorAll('.tab-btn').forEach((btn) => {
	btn.onclick = () => {
		document
			.querySelectorAll('.tab-btn')
			.forEach((b) => b.classList.remove('active'));
		document
			.querySelectorAll('.tab-pane')
			.forEach((p) => p.classList.remove('active'));
		btn.classList.add('active');
		document.getElementById(btn.dataset.target).classList.add('active');
	};
});
dom.engineSelect.onchange = (e) => {
	currentEngine = e.target.value;
	if (isInitialized) buildAudioEngine();
	updateUIStates();
	saveSettings();
};
dom.modeSelect.onchange = async (e) => {
	inputMode = e.target.value;
	updateUIStates();
	if (inputMode === 'mic' && !isMicInitialized && isInitialized)
		await setupMicrophone();
	saveSettings();
};
dom.recordTriggerSelect.onchange = (e) => {
	recordTrigger = e.target.value;
	saveSettings();
};
dom.vibrationSelect.onchange = (e) => {
	useVibration = e.target.value === 'on';
	saveSettings();
};
dom.touchPressureSelect.onchange = (e) => {
	useTouchPressure = e.target.value === 'on';
	saveSettings();
};
dom.yVolSelect.onchange = (e) => {
	useYVol = e.target.value === 'on';
	saveSettings();
};
dom.slideModeSelect.onchange = (e) => {
	slideMode = e.target.value;
	drawGuides();
	saveSettings();
};
dom.lipModeSelect.onchange = (e) => {
	lipMode = e.target.value;
	updateUIStates();
	drawGuides();
	saveSettings();
};
dom.lipDirSelect.onchange = (e) => {
	lipDir = e.target.value;
	saveSettings();
};
dom.micSelect.onchange = (e) => {
	setupMicrophone(e.target.value);
	saveSettings();
};
dom.simpleVol.oninput = (e) => {
	document.getElementById('val-simple-vol').innerText = e.target.value;
};
dom.simpleVol.onchange = (e) => {
	saveSettings();
};
dom.micSens.oninput = (e) => {
	document.getElementById('val-mic-sens').innerText = e.target.value;
};
dom.micSens.onchange = (e) => {
	saveSettings();
};
dom.lipSens.oninput = (e) => {
	document.getElementById('val-lip-sens').innerText = e.target.value;
};
dom.lipSens.onchange = (e) => {
	saveSettings();
};
document.getElementById('fullscreen-btn').onclick = () => {
	if (!document.fullscreenElement)
		document.documentElement.requestFullscreen().catch(() => {});
	else document.exitFullscreen();
};
const playArea = dom.playScreen;
playArea.addEventListener(
	'touchstart',
	(e) => {
		e.preventDefault();
		handleInput(e);
	},
	{ passive: false },
);
playArea.addEventListener(
	'touchmove',
	(e) => {
		e.preventDefault();
		handleInput(e);
	},
	{ passive: false },
);
playArea.addEventListener(
	'touchend',
	(e) => {
		e.preventDefault();
		if (e.touches.length === 0) {
			lastLipTouchY = null;
			partialAccumulator = 0;
			handleStop();
		} else handleInput(e);
	},
	{ passive: false },
);
playArea.addEventListener(
	'touchcancel',
	(e) => {
		e.preventDefault();
		lastLipTouchY = null;
		partialAccumulator = 0;
		handleStop();
	},
	{ passive: false },
);
playArea.addEventListener('mousedown', (e) => {
	if (e.target === dom.openSettingsBtn || e.target === dom.recordBtn) return;
	const move = (ev) => handleInput(ev);
	const stop = () => {
		window.removeEventListener('mousemove', move);
		window.removeEventListener('mouseup', stop);
		handleStop();
	};
	window.addEventListener('mousemove', move);
	window.addEventListener('mouseup', stop);
	handleInput(e);
});
playArea.addEventListener(
	'wheel',
	(e) => {
		if (e.cancelable) e.preventDefault();
		if (lipMode === 'pro' && isPlaying) {
			if (e.deltaY < 0)
				changePartial(
					currentPartialNum + (lipDir === 'normal' ? 1 : -1),
				);
			else
				changePartial(
					currentPartialNum + (lipDir === 'normal' ? -1 : 1),
				);
			handleInput(e);
		}
	},
	{ passive: false },
);

// アプリの更新処理
// 変更後
document.getElementById('update-app-btn').onclick = async () => {
	// 1. Service Workerの登録を解除
	if ('serviceWorker' in navigator) {
		const registrations = await navigator.serviceWorker.getRegistrations();
		for (const registration of registrations) {
			await registration.unregister();
		}
	}

	// 2. キャッシュを全て削除
	if ('caches' in window) {
		const cacheNames = await caches.keys();
		await Promise.all(cacheNames.map((name) => caches.delete(name)));
	}

	// 3. ページをリロードして最新のファイルを取得
	window.location.reload();
};

handleResize();
loadSettings();
updateUIStates();
drawGuides();
dom.statusNote.innerText = `音階: -`;
