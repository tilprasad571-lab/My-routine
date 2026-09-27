import { BuiltInSoundId, NotificationSoundId } from '../types';

let activeAudioElement: HTMLAudioElement | null = null;
let activeAudioContext: AudioContext | null = null;
let sharedUnlockedContext: AudioContext | null = null;
let activeLoopInterval: ReturnType<typeof setInterval> | null = null;
let activeLoopStopTimeout: ReturnType<typeof setTimeout> | null = null;
let audioUnlockedFlag = false;
let unlockListenersAttached = false;

function getAudioContextConstructor(): typeof AudioContext | null {
  if (typeof window === 'undefined') return null;
  return (
    window.AudioContext ||
    (window as unknown as { webkitAudioContext?: typeof AudioContext })
      .webkitAudioContext ||
    null
  );
}

export function unlockAudioContext(): boolean {
  try {
    const AudioCtx = getAudioContextConstructor();
    if (!AudioCtx) return false;
    if (!sharedUnlockedContext || sharedUnlockedContext.state === 'closed') {
      sharedUnlockedContext = new AudioCtx();
    }
    if (sharedUnlockedContext.state === 'suspended') {
      sharedUnlockedContext.resume().catch(() => {});
    }
    // Play a silent 1-sample buffer to unlock iOS/Android WebAudio in background
    const buffer = sharedUnlockedContext.createBuffer(1, 1, 22050);
    const source = sharedUnlockedContext.createBufferSource();
    source.buffer = buffer;
    source.connect(sharedUnlockedContext.destination);
    source.start(0);
    audioUnlockedFlag = true;
    return true;
  } catch {
    return false;
  }
}

export function isAudioUnlocked(): boolean {
  if (audioUnlockedFlag) return true;
  if (sharedUnlockedContext && sharedUnlockedContext.state === 'running') {
    return true;
  }
  return false;
}

export function setupGlobalAudioUnlock(): void {
  if (typeof window === 'undefined' || unlockListenersAttached) return;
  unlockListenersAttached = true;

  const handleUserGesture = () => {
    unlockAudioContext();
  };

  window.addEventListener('pointerdown', handleUserGesture, { passive: true });
  window.addEventListener('touchstart', handleUserGesture, { passive: true });
  window.addEventListener('keydown', handleUserGesture, { passive: true });
  window.addEventListener('click', handleUserGesture, { passive: true });
}

export function triggerDeviceVibration(pattern: number | number[] = [300, 150, 300, 150, 400]): void {
  try {
    if (typeof navigator !== 'undefined' && typeof navigator.vibrate === 'function') {
      navigator.vibrate(pattern);
    }
  } catch {
    // Ignore vibration errors on unsupported devices
  }
}

export function stopActiveSound(): void {
  if (activeLoopInterval) {
    clearInterval(activeLoopInterval);
    activeLoopInterval = null;
  }
  if (activeLoopStopTimeout) {
    clearTimeout(activeLoopStopTimeout);
    activeLoopStopTimeout = null;
  }
  if (activeAudioElement) {
    try {
      activeAudioElement.loop = false;
      activeAudioElement.pause();
      activeAudioElement.currentTime = 0;
    } catch {
      // Ignore audio pause errors
    }
    activeAudioElement = null;
  }
  if (activeAudioContext) {
    try {
      if (
        activeAudioContext !== sharedUnlockedContext &&
        activeAudioContext.state !== 'closed'
      ) {
        activeAudioContext.close().catch(() => {});
      }
    } catch {
      // Ignore context close errors
    }
    activeAudioContext = null;
  }
  try {
    if (typeof navigator !== 'undefined' && typeof navigator.vibrate === 'function') {
      navigator.vibrate(0);
    }
  } catch {
    // Ignore
  }
}

function playSingleBuiltInChime(soundId: BuiltInSoundId = 'default_1'): void {
  try {
    const AudioCtx = getAudioContextConstructor();
    if (!AudioCtx) return;

    let ctx: AudioContext;
    if (sharedUnlockedContext && sharedUnlockedContext.state !== 'closed') {
      ctx = sharedUnlockedContext;
    } else {
      ctx = new AudioCtx();
      sharedUnlockedContext = ctx;
    }
    activeAudioContext = ctx;
    if (ctx.state === 'suspended') {
      ctx.resume().catch(() => {});
    }

    if (soundId === 'default_2') {
      // Default Sound 2: Crystal Bell (C5 -> E5 -> G5 -> C6 harmonic arpeggio repeated twice)
      const notes = [
        { freq: 523.25, start: 0.0, dur: 0.22 },
        { freq: 659.25, start: 0.18, dur: 0.22 },
        { freq: 783.99, start: 0.36, dur: 0.22 },
        { freq: 1046.5, start: 0.54, dur: 0.42 },
        { freq: 523.25, start: 1.08, dur: 0.22 },
        { freq: 659.25, start: 1.26, dur: 0.22 },
        { freq: 783.99, start: 1.44, dur: 0.22 },
        { freq: 1046.5, start: 1.62, dur: 0.48 },
      ];

      for (const n of notes) {
        const osc = ctx.createOscillator();
        const overtone = ctx.createOscillator();
        const gain = ctx.createGain();

        osc.type = 'triangle';
        overtone.type = 'sine';
        osc.frequency.setValueAtTime(n.freq, ctx.currentTime + n.start);
        overtone.frequency.setValueAtTime(n.freq * 2, ctx.currentTime + n.start);

        gain.gain.setValueAtTime(0.22, ctx.currentTime + n.start);
        gain.gain.exponentialRampToValueAtTime(
          0.001,
          ctx.currentTime + n.start + n.dur
        );

        osc.connect(gain);
        overtone.connect(gain);
        gain.connect(ctx.destination);

        osc.start(ctx.currentTime + n.start);
        overtone.start(ctx.currentTime + n.start);
        osc.stop(ctx.currentTime + n.start + n.dur);
        overtone.stop(ctx.currentTime + n.start + n.dur);
      }
      return;
    }

    if (soundId === 'default_3') {
      // Default Sound 3: Classic Digital Alarm Pulse (Rhythmic dual-tone alert)
      const pulses = [
        { freq: 880.0, start: 0.0, dur: 0.13 },
        { freq: 1174.66, start: 0.15, dur: 0.15 },
        { freq: 880.0, start: 0.45, dur: 0.13 },
        { freq: 1174.66, start: 0.6, dur: 0.15 },
        { freq: 880.0, start: 0.9, dur: 0.13 },
        { freq: 1318.51, start: 1.05, dur: 0.28 },
      ];

      for (const p of pulses) {
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.type = 'square';
        osc.frequency.setValueAtTime(p.freq, ctx.currentTime + p.start);
        gain.gain.setValueAtTime(0.12, ctx.currentTime + p.start);
        gain.gain.exponentialRampToValueAtTime(
          0.001,
          ctx.currentTime + p.start + p.dur
        );
        osc.connect(gain);
        gain.connect(ctx.destination);
        osc.start(ctx.currentTime + p.start);
        osc.stop(ctx.currentTime + p.start + p.dur);
      }
      return;
    }

    // Default Sound 1 (default_1): Gentle Chime (D5 -> F#5 -> A5 repeated twice)
    const notes = [
      { freq: 587.33, start: 0, dur: 0.22 },
      { freq: 739.99, start: 0.24, dur: 0.22 },
      { freq: 880.0, start: 0.48, dur: 0.38 },
      { freq: 587.33, start: 1.0, dur: 0.22 },
      { freq: 739.99, start: 1.24, dur: 0.22 },
      { freq: 880.0, start: 1.48, dur: 0.45 },
    ];

    for (const n of notes) {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = 'sine';
      osc.frequency.setValueAtTime(n.freq, ctx.currentTime + n.start);
      gain.gain.setValueAtTime(0.2, ctx.currentTime + n.start);
      gain.gain.exponentialRampToValueAtTime(
        0.001,
        ctx.currentTime + n.start + n.dur
      );
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.start(ctx.currentTime + n.start);
      osc.stop(ctx.currentTime + n.start + n.dur);
    }
  } catch {
    // Ignore audio errors if blocked by browser autoplay policy
  }
}

export function playBuiltInSound(
  soundId: BuiltInSoundId = 'default_1',
  options?: { loop?: boolean; maxDurationMs?: number }
): void {
  stopActiveSound();
  const shouldLoop = Boolean(options?.loop);
  const maxDurationMs = options?.maxDurationMs ?? 25000;

  playSingleBuiltInChime(soundId);
  if (shouldLoop) {
    triggerDeviceVibration([300, 150, 300, 150, 400]);
    activeLoopInterval = setInterval(() => {
      playSingleBuiltInChime(soundId);
      triggerDeviceVibration([250, 120, 250]);
    }, 2600);
    activeLoopStopTimeout = setTimeout(() => {
      stopActiveSound();
    }, maxDurationMs);
  }
}

export function playReminderSound(options: {
  soundId?: NotificationSoundId;
  defaultSoundId?: BuiltInSoundId;
  customSoundDataUrl?: string | null;
  loop?: boolean;
  maxDurationMs?: number;
}): void {
  const shouldLoop = Boolean(options.loop);
  const maxDurationMs = options.maxDurationMs ?? 25000;

  const fallbackBuiltIn: BuiltInSoundId =
    options.defaultSoundId &&
    ['default_1', 'default_2', 'default_3'].includes(options.defaultSoundId)
      ? options.defaultSoundId
      : 'default_1';

  const targetSound: NotificationSoundId =
    options.soundId &&
    ['default_1', 'default_2', 'default_3', 'custom'].includes(options.soundId)
      ? options.soundId
      : fallbackBuiltIn;

  if (targetSound === 'custom') {
    const dataUrl = (options.customSoundDataUrl || '').trim();
    if (!dataUrl || !dataUrl.startsWith('data:audio/')) {
      // Custom sound unavailable — safely fall back to the selected built-in sound
      playBuiltInSound(fallbackBuiltIn, { loop: shouldLoop, maxDurationMs });
      return;
    }

    stopActiveSound();
    try {
      const audio = new Audio(dataUrl);
      audio.loop = shouldLoop;
      activeAudioElement = audio;
      if (shouldLoop) {
        triggerDeviceVibration([300, 150, 300, 150, 400]);
        activeLoopStopTimeout = setTimeout(() => {
          stopActiveSound();
        }, maxDurationMs);
      }
      let fallbackTriggered = false;
      const triggerFallback = () => {
        if (fallbackTriggered) return;
        fallbackTriggered = true;
        activeAudioElement = null;
        playBuiltInSound(fallbackBuiltIn, { loop: shouldLoop, maxDurationMs });
      };

      audio.onerror = triggerFallback;
      const playPromise = audio.play();
      if (playPromise && typeof playPromise.catch === 'function') {
        playPromise.catch(() => {
          triggerFallback();
        });
      }
    } catch {
      playBuiltInSound(fallbackBuiltIn, { loop: shouldLoop, maxDurationMs });
    }
    return;
  }

  playBuiltInSound(targetSound, { loop: shouldLoop, maxDurationMs });
}
