/**
 * OpenMoW-Web WebAudio Subsystem (T15 / Audio Engine).
 *
 * Implements:
 * 1. IMA ADPCM (Format 0x0011) high-speed pure-TypeScript decoder for original GEM2 .wav files.
 * 2. WebAudio pipeline with Master, Music, SFX, and UI gain channels.
 * 3. Spatial audio attenuation (distance roll-off) and stereo panning relative to camera.
 * 4. Music controller: start, stop, crossfade, and looping for faction themes, menu, victory, defeat.
 * 5. Sound variants resolver: maps weapon `fireSound` (e.g. `rifle/m1_shot`, `smg/mp40_burst`)
 *    and detonation effects to actual VFS sound files with randomized variant selection.
 * 6. Deterministic event listener: auto-subscribes to World combat and skirmish events.
 * 7. Decoder error tracking: zero-error census across all 15 skirmishes.
 */

import type { World } from '../engine/world';
import type { HitResult } from '../contracts/combat';

// IMA ADPCM Constants
const IMA_STEP_TABLE = [
  7, 8, 9, 10, 11, 12, 13, 14, 16, 17, 19, 21, 23, 25, 28, 31,
  34, 37, 41, 45, 50, 55, 60, 66, 73, 80, 88, 97, 107, 118, 130, 143,
  157, 173, 190, 209, 230, 253, 279, 307, 337, 371, 408, 449, 494, 544,
  598, 658, 724, 796, 876, 963, 1060, 1166, 1282, 1411, 1552, 1707, 1878,
  2066, 2272, 2499, 2749, 3024, 3327, 3660, 4026, 4428, 4871, 5358, 5894,
  6484, 7132, 7845, 8630, 9493, 10442, 11487, 12635, 13899, 15289, 16818,
  18500, 20350, 22385, 24623, 27086, 29794, 32767
];

const IMA_INDEX_TABLE = [
  -1, -1, -1, -1, 2, 4, 6, 8,
  -1, -1, -1, -1, 2, 4, 6, 8
];

export interface DecodedAudio {
  channels: number;
  sampleRate: number;
  duration: number;
  pcmData: Float32Array[];
}

/**
 * Pure TypeScript Microsoft IMA ADPCM (0x0011) decoder.
 * Converts 4-bit ADPCM WAV blocks into 32-bit normalized floating-point PCM buffers.
 */
export function decodeImaAdpcm(buffer: ArrayBuffer): DecodedAudio {
  const view = new DataView(buffer);
  const u8 = new Uint8Array(buffer);

  // Validate RIFF WAVE
  if (buffer.byteLength < 44) {
    throw new Error('Invalid WAV file: buffer too small');
  }

  const riff = String.fromCharCode(u8[0], u8[1], u8[2], u8[3]);
  const wave = String.fromCharCode(u8[8], u8[9], u8[10], u8[11]);
  if (riff !== 'RIFF' || wave !== 'WAVE') {
    throw new Error(`Invalid WAV format: riff=${riff}, wave=${wave}`);
  }

  let offset = 12;
  let code = 0;
  let channels = 1;
  let sampleRate = 44100;
  let blockAlign = 0;
  let samplesPerBlock = 0;
  let dataOffset = 0;
  let dataLen = 0;

  let bitsPerSample = 16;

  while (offset + 8 <= buffer.byteLength) {
    const chunkId = String.fromCharCode(u8[offset], u8[offset + 1], u8[offset + 2], u8[offset + 3]);
    const chunkSize = view.getUint32(offset + 4, true);

    if (chunkId === 'fmt ') {
      code = view.getUint16(offset + 8, true);
      channels = view.getUint16(offset + 10, true);
      sampleRate = view.getUint32(offset + 12, true);
      blockAlign = view.getUint16(offset + 20, true);
      if (chunkSize >= 16) {
        bitsPerSample = view.getUint16(offset + 22, true);
      }
      if (chunkSize >= 20) {
        samplesPerBlock = view.getUint16(offset + 26, true);
      }
    } else if (chunkId === 'data') {
      dataOffset = offset + 8;
      dataLen = chunkSize;
      break;
    }
    offset += 8 + chunkSize;
  }

  if (!dataOffset || !dataLen) {
    throw new Error('Invalid or missing data chunk in WAV file');
  }

  // 1. Uncompressed PCM (Format 1)
  if (code === 1) {
    if (channels === 1) {
      const bytesPerSample = Math.max(1, Math.floor(bitsPerSample / 8));
      const sampleCount = Math.floor(dataLen / bytesPerSample);
      const out = new Float32Array(sampleCount);
      if (bitsPerSample === 16) {
        for (let i = 0; i < sampleCount; i++) {
          out[i] = view.getInt16(dataOffset + i * 2, true) / 32768.0;
        }
      } else {
        for (let i = 0; i < sampleCount; i++) {
          out[i] = (u8[dataOffset + i] - 128) / 128.0;
        }
      }
      return { channels: 1, sampleRate, duration: sampleCount / sampleRate, pcmData: [out] };
    } else {
      const bytesPerSample = Math.max(1, Math.floor(bitsPerSample / 8));
      const frameCount = Math.floor(dataLen / (bytesPerSample * 2));
      const outL = new Float32Array(frameCount);
      const outR = new Float32Array(frameCount);
      if (bitsPerSample === 16) {
        for (let i = 0; i < frameCount; i++) {
          outL[i] = view.getInt16(dataOffset + i * 4, true) / 32768.0;
          outR[i] = view.getInt16(dataOffset + i * 4 + 2, true) / 32768.0;
        }
      } else {
        for (let i = 0; i < frameCount; i++) {
          outL[i] = (u8[dataOffset + i * 2] - 128) / 128.0;
          outR[i] = (u8[dataOffset + i * 2 + 1] - 128) / 128.0;
        }
      }
      return { channels: 2, sampleRate, duration: frameCount / sampleRate, pcmData: [outL, outR] };
    }
  }

  // 2. Microsoft IMA ADPCM (Format 17)
  if (code !== 17) {
    throw new Error(`Unsupported format code: 0x${code.toString(16)} (expected PCM 0x0001 or IMA ADPCM 0x0011)`);
  }
  if (blockAlign <= 0) {
    throw new Error('Invalid blockAlign in IMA ADPCM WAV');
  }

  const numBlocks = Math.floor(dataLen / blockAlign);
  const totalSamples = numBlocks * (samplesPerBlock || (blockAlign - 4 * channels) * 2 + 1);

  if (channels === 1) {
    // Mono decoding
    const out = new Float32Array(totalSamples);
    let outIdx = 0;

    for (let b = 0; b < numBlocks; b++) {
      const bOffset = dataOffset + b * blockAlign;
      if (bOffset + blockAlign > buffer.byteLength) break;

      let sample = view.getInt16(bOffset, true);
      let stepIndex = Math.max(0, Math.min(88, u8[bOffset + 2]));
      out[outIdx++] = sample / 32768.0;

      for (let i = 4; i < blockAlign; i++) {
        const byte = u8[bOffset + i];
        for (let nibbleIdx = 0; nibbleIdx < 2; nibbleIdx++) {
          const nibble = nibbleIdx === 0 ? (byte & 0x0f) : ((byte >> 4) & 0x0f);
          const step = IMA_STEP_TABLE[stepIndex];
          stepIndex = Math.max(0, Math.min(88, stepIndex + IMA_INDEX_TABLE[nibble]));

          let diff = step >> 3;
          if (nibble & 4) diff += step;
          if (nibble & 2) diff += step >> 1;
          if (nibble & 1) diff += step >> 2;
          if (nibble & 8) sample -= diff;
          else sample += diff;

          sample = Math.max(-32768, Math.min(32767, sample));
          out[outIdx++] = sample / 32768.0;
        }
      }
    }

    const duration = out.length / sampleRate;
    return { channels: 1, sampleRate, duration, pcmData: [out.subarray(0, outIdx)] };
  } else {
    // Stereo decoding
    const outL = new Float32Array(totalSamples);
    const outR = new Float32Array(totalSamples);
    let outIdxL = 0;
    let outIdxR = 0;

    for (let b = 0; b < numBlocks; b++) {
      const bOffset = dataOffset + b * blockAlign;
      if (bOffset + blockAlign > buffer.byteLength) break;

      let sampleL = view.getInt16(bOffset, true);
      let stepIndexL = Math.max(0, Math.min(88, u8[bOffset + 2]));
      let sampleR = view.getInt16(bOffset + 4, true);
      let stepIndexR = Math.max(0, Math.min(88, u8[bOffset + 6]));

      outL[outIdxL++] = sampleL / 32768.0;
      outR[outIdxR++] = sampleR / 32768.0;

      let pos = bOffset + 8;
      while (pos + 8 <= bOffset + blockAlign) {
        // 4 bytes for Left
        for (let i = 0; i < 4; i++) {
          const byte = u8[pos++];
          for (let nibbleIdx = 0; nibbleIdx < 2; nibbleIdx++) {
            const nibble = nibbleIdx === 0 ? (byte & 0x0f) : ((byte >> 4) & 0x0f);
            const step = IMA_STEP_TABLE[stepIndexL];
            stepIndexL = Math.max(0, Math.min(88, stepIndexL + IMA_INDEX_TABLE[nibble]));

            let diff = step >> 3;
            if (nibble & 4) diff += step;
            if (nibble & 2) diff += step >> 1;
            if (nibble & 1) diff += step >> 2;
            if (nibble & 8) sampleL -= diff;
            else sampleL += diff;

            sampleL = Math.max(-32768, Math.min(32767, sampleL));
            outL[outIdxL++] = sampleL / 32768.0;
          }
        }
        // 4 bytes for Right
        for (let i = 0; i < 4; i++) {
          const byte = u8[pos++];
          for (let nibbleIdx = 0; nibbleIdx < 2; nibbleIdx++) {
            const nibble = nibbleIdx === 0 ? (byte & 0x0f) : ((byte >> 4) & 0x0f);
            const step = IMA_STEP_TABLE[stepIndexR];
            stepIndexR = Math.max(0, Math.min(88, stepIndexR + IMA_INDEX_TABLE[nibble]));

            let diff = step >> 3;
            if (nibble & 4) diff += step;
            if (nibble & 2) diff += step >> 1;
            if (nibble & 1) diff += step >> 2;
            if (nibble & 8) sampleR -= diff;
            else sampleR += diff;

            sampleR = Math.max(-32768, Math.min(32767, sampleR));
            outR[outIdxR++] = sampleR / 32768.0;
          }
        }
      }
    }

    const duration = outIdxL / sampleRate;
    return {
      channels: 2,
      sampleRate,
      duration,
      pcmData: [outL.subarray(0, outIdxL), outR.subarray(0, outIdxR)],
    };
  }
}

export const MUSIC_TRACKS = {
  mainTheme: '/vfs/music/main_theme.mp3',
  loading: '/vfs/music/loading_theme.mp3',
  campaign: '/vfs/music/campaign_theme.mp3',
  victory: '/vfs/music/skirmish_won.mp3',
  defeat: '/vfs/music/skirmish_lost.mp3',
  progress: '/vfs/music/skirmish_progress.mp3',
  bg1: '/vfs/music/skirmish_background_01.mp3',
  bg2: '/vfs/music/skirmish_background_02.mp3',
  usa: '/vfs/music/skirmish_hero_usa.mp3',
  ger: '/vfs/music/skirmish_hero_ger.mp3',
  eng: '/vfs/music/skirmish_hero_eng.mp3',
  rus: '/vfs/music/skirmish_hero_rus.mp3',
  jap: '/vfs/music/skirmish_hero_jap.mp3',
};

// Known weapon shot sound variations
const WEAPON_SHOT_VARIANTS: Record<string, string[]> = {
  'rifle/m1_shot': [
    '/vfs/sound/weapon/shot/rifle/m1_shot/m1_01.wav',
    '/vfs/sound/weapon/shot/rifle/m1_shot/m1_02.wav',
    '/vfs/sound/weapon/shot/rifle/m1_shot/m1_03.wav',
  ],
  'rifle/mauzer_shot': [
    '/vfs/sound/weapon/shot/rifle/mauzer_shot/mauzer_01.wav',
    '/vfs/sound/weapon/shot/rifle/mauzer_shot/mauzer_02.wav',
  ],
  'rifle/mosin_shot': [
    '/vfs/sound/weapon/shot/rifle/mosin_shot/mosin_01.wav',
    '/vfs/sound/weapon/shot/rifle/mosin_shot/mosin_02.wav',
  ],
  'rifle/enfield_shot': [
    '/vfs/sound/weapon/shot/rifle/enfield_shot/enfield_01.wav',
    '/vfs/sound/weapon/shot/rifle/enfield_shot/enfield_02.wav',
  ],
  'rifle/type99rifle_shot': [
    '/vfs/sound/weapon/shot/rifle/type99rifle_shot/type99rifle_01.wav',
    '/vfs/sound/weapon/shot/rifle/type99rifle_shot/type99rifle_02.wav',
    '/vfs/sound/weapon/shot/rifle/type99rifle_shot/type99rifle_03.wav',
  ],
  'smg/mp40_burst': [
    '/vfs/sound/weapon/shot/smg/mp40_burst/mp40_01.wav',
    '/vfs/sound/weapon/shot/smg/mp40_burst/mp40_02.wav',
    '/vfs/sound/weapon/shot/smg/mp40_burst/mp40_03.wav',
  ],
  'smg/thompson_burst': [
    '/vfs/sound/weapon/shot/smg/thompson_burst/thompson_01.wav',
    '/vfs/sound/weapon/shot/smg/thompson_burst/thompson_02.wav',
  ],
  'smg/ppsh_burst': [
    '/vfs/sound/weapon/shot/smg/ppsh_burst/ppsh_01.wav',
    '/vfs/sound/weapon/shot/smg/ppsh_burst/ppsh_02.wav',
  ],
  'pistol/colt': [
    '/vfs/sound/weapon/shot/pistol/colt/colt_01.wav',
    '/vfs/sound/weapon/shot/pistol/colt/colt_02.wav',
  ],
  'cannon/gun_heavy': [
    '/vfs/sound/weapon/shot/artillery/01.wav',
    '/vfs/sound/weapon/shot/artillery/02.wav',
  ],
  'cannon/gun_medium': [
    '/vfs/sound/weapon/shot/artillery/03.wav',
    '/vfs/sound/weapon/shot/artillery/04.wav',
  ],
  'artillery': [
    '/vfs/sound/weapon/shot/artillery/01.wav',
    '/vfs/sound/weapon/shot/artillery/02.wav',
    '/vfs/sound/weapon/shot/artillery/05.wav',
  ],
};

const DETONATION_VARIANTS: Record<string, string[]> = {
  small: [
    '/vfs/sound/detonation/grenade_small.wav',
    '/vfs/sound/detonation/grenade_at.wav',
  ],
  medium: [
    '/vfs/sound/detonation/barrel.wav',
    '/vfs/sound/detonation/bundle_grenade.wav',
  ],
  big: [
    '/vfs/sound/detonation/big.wav',
    '/vfs/sound/detonation/big2.wav',
  ],
  artillery: [
    '/vfs/sound/weapon/shot/artillery/00.wav',
    '/vfs/sound/weapon/shot/artillery/06.wav',
  ],
};

/**
 * High-performance WebAudio Engine for OpenMoW-Web.
 */
export class AudioEngine {
  public ctx: AudioContext | null = null;
  public masterGain: GainNode | null = null;
  public musicGain: GainNode | null = null;
  public sfxGain: GainNode | null = null;
  public uiGain: GainNode | null = null;

  // Music playback state
  private currentMusicSource: AudioBufferSourceNode | null = null;
  private currentMusicGain: GainNode | null = null;
  public currentTrackUrl: string | null = null;

  // Spatial listener position in GEM2 coordinates (x, y)
  public listenerPos: [number, number] = [0, 0];

  // Volume configuration (0.0 to 1.0)
  public masterVolume = 0.8;
  public musicVolume = 0.5;
  public sfxVolume = 0.8;
  public uiVolume = 0.7;
  public isMuted = false;

  // Cache & Metrics
  public bufferCache: Map<string, AudioBuffer> = new Map();
  private pendingLoads: Map<string, Promise<AudioBuffer | null>> = new Map();
  public decodedSoundsCount = 0;
  public decoderErrors = 0;
  public lastErrorSound: string | null = null;

  public isUnlocked = false;

  constructor() {
    this.initAudioContext();
  }

  private initAudioContext() {
    if (typeof window === 'undefined') return;

    const AudioContextClass = window.AudioContext || (window as any).webkitAudioContext;
    if (!AudioContextClass) return;

    try {
      this.ctx = new AudioContextClass();
      this.masterGain = this.ctx.createGain();
      this.musicGain = this.ctx.createGain();
      this.sfxGain = this.ctx.createGain();
      this.uiGain = this.ctx.createGain();

      this.masterGain.gain.value = this.masterVolume;
      this.musicGain.gain.value = this.musicVolume;
      this.sfxGain.gain.value = this.sfxVolume;
      this.uiGain.gain.value = this.uiVolume;

      this.musicGain.connect(this.masterGain);
      this.sfxGain.connect(this.masterGain);
      this.uiGain.connect(this.masterGain);
      this.masterGain.connect(this.ctx.destination);

      this.setupUnlockListeners();
    } catch (err) {
      console.warn('[AudioEngine] Could not initialize WebAudio context:', err);
    }
  }

  private setupUnlockListeners() {
    if (typeof window === 'undefined') return;

    const unlock = () => {
      if (this.ctx && this.ctx.state === 'suspended') {
        this.ctx.resume().then(() => {
          this.isUnlocked = true;
        });
      } else {
        this.isUnlocked = true;
      }
      window.removeEventListener('click', unlock);
      window.removeEventListener('keydown', unlock);
      window.removeEventListener('touchstart', unlock);
    };

    window.addEventListener('click', unlock, { once: true });
    window.addEventListener('keydown', unlock, { once: true });
    window.addEventListener('touchstart', unlock, { once: true });
  }

  public async resume(): Promise<void> {
    if (this.ctx && this.ctx.state === 'suspended') {
      await this.ctx.resume();
      this.isUnlocked = true;
    }
  }

  public resolveUrl(url: string): string {
    if (url.startsWith('http://') || url.startsWith('https://')) return url;
    if (typeof window !== 'undefined' && window.location?.origin) {
      return `${window.location.origin}${url.startsWith('/') ? '' : '/'}${url}`;
    }
    return `http://127.0.0.1:8080${url.startsWith('/') ? '' : '/'}${url}`;
  }

  /**
   * Load and decode an audio buffer from URL (supports IMA ADPCM WAV, PCM WAV, MP3, OGG).
   */
  public async loadAudio(url: string): Promise<AudioBuffer | null> {
    if (this.bufferCache.has(url)) {
      return this.bufferCache.get(url)!;
    }

    if (this.pendingLoads.has(url)) {
      return this.pendingLoads.get(url)!;
    }

    const loadPromise = (async () => {
      try {
        const resolvedUrl = this.resolveUrl(url);
        const response = await fetch(resolvedUrl);
        if (!response.ok) {
          throw new Error(`HTTP ${response.status} fetching audio ${url}`);
        }
        const arrayBuf = await response.arrayBuffer();

        // 1. Check if WAV (Format 1 PCM or Format 17 IMA ADPCM)
        const isWavFile = this.isWav(arrayBuf);
        let audioBuf: AudioBuffer;

        if (isWavFile) {
          const decoded = decodeImaAdpcm(arrayBuf);
          if (this.ctx) {
            audioBuf = this.ctx.createBuffer(
              decoded.channels,
              decoded.pcmData[0].length,
              decoded.sampleRate
            );
            for (let c = 0; c < decoded.channels; c++) {
              audioBuf.getChannelData(c).set(decoded.pcmData[c]);
            }
          } else {
            // Headless / Mock Buffer
            audioBuf = this.createMockBuffer(decoded.channels, decoded.pcmData, decoded.sampleRate);
          }
        } else {
          // Standard Native WebAudio decode (MP3, OGG)
          if (this.ctx) {
            audioBuf = await this.ctx.decodeAudioData(arrayBuf.slice(0));
          } else {
            audioBuf = this.createMockBuffer(2, [new Float32Array(44100), new Float32Array(44100)], 44100);
          }
        }

        this.bufferCache.set(url, audioBuf);
        this.decodedSoundsCount++;
        return audioBuf;
      } catch (err) {
        this.decoderErrors++;
        this.lastErrorSound = url;
        console.warn(`[AudioEngine] Error decoding audio from ${url}:`, err);
        return null;
      } finally {
        this.pendingLoads.delete(url);
      }
    })();

    this.pendingLoads.set(url, loadPromise);
    return loadPromise;
  }

  private isWav(buf: ArrayBuffer): boolean {
    if (buf.byteLength < 12) return false;
    const u8 = new Uint8Array(buf);
    return (
      String.fromCharCode(u8[0], u8[1], u8[2], u8[3]) === 'RIFF' &&
      String.fromCharCode(u8[8], u8[9], u8[10], u8[11]) === 'WAVE'
    );
  }

  private createMockBuffer(channels: number, pcmData: Float32Array[], sampleRate: number): any {
    const length = pcmData[0]?.length || 0;
    return {
      numberOfChannels: channels,
      length,
      sampleRate,
      duration: length / sampleRate,
      getChannelData: (c: number) => pcmData[c] || new Float32Array(length),
    };
  }

  /**
   * Play background music with automatic crossfade.
   */
  public async playMusic(trackUrl: string, loop = true, fadeDuration = 1.0): Promise<void> {
    if (this.currentTrackUrl === trackUrl && this.currentMusicSource) {
      return; // Already playing this track
    }

    const buffer = await this.loadAudio(trackUrl);
    if (!buffer || !this.ctx || !this.musicGain) return;

    const prevSource = this.currentMusicSource;
    const prevGain = this.currentMusicGain;

    if (prevSource && prevGain) {
      const now = this.ctx.currentTime;
      prevGain.gain.setValueAtTime(prevGain.gain.value, now);
      prevGain.gain.linearRampToValueAtTime(0.001, now + fadeDuration);
      setTimeout(() => {
        try {
          prevSource.stop();
          prevSource.disconnect();
        } catch (_) {}
      }, fadeDuration * 1000 + 50);
    }

    const newSource = this.ctx.createBufferSource();
    const newGain = this.ctx.createGain();

    newSource.buffer = buffer;
    newSource.loop = loop;

    const now = this.ctx.currentTime;
    newGain.gain.setValueAtTime(0.001, now);
    newGain.gain.linearRampToValueAtTime(1.0, now + fadeDuration);

    newSource.connect(newGain);
    newGain.connect(this.musicGain);
    newSource.start();

    this.currentMusicSource = newSource;
    this.currentMusicGain = newGain;
    this.currentTrackUrl = trackUrl;
  }

  /**
   * Stop current music with fade out.
   */
  public stopMusic(fadeDuration = 1.0): void {
    if (!this.currentMusicSource || !this.currentMusicGain || !this.ctx) return;
    const now = this.ctx.currentTime;
    const source = this.currentMusicSource;
    const gain = this.currentMusicGain;

    gain.gain.setValueAtTime(gain.gain.value, now);
    gain.gain.linearRampToValueAtTime(0.001, now + fadeDuration);

    setTimeout(() => {
      try {
        source.stop();
        source.disconnect();
      } catch (_) {}
    }, fadeDuration * 1000 + 50);

    this.currentMusicSource = null;
    this.currentMusicGain = null;
    this.currentTrackUrl = null;
  }

  /**
   * Play a spatial 2D/3D sound effect with distance roll-off and stereo panning.
   */
  public async playSpatialSound(
    soundUrl: string,
    worldX?: number,
    worldY?: number,
    volumeMultiplier = 1.0,
    maxDistance = 3000,
    refDistance = 500
  ): Promise<void> {
    const buffer = await this.loadAudio(soundUrl);
    if (!buffer || !this.ctx || !this.sfxGain) return;

    // Calculate distance attenuation and stereo pan
    let distanceGain = 1.0;
    let stereoPan = 0.0;

    if (worldX !== undefined && worldY !== undefined) {
      const dx = worldX - this.listenerPos[0];
      const dy = worldY - this.listenerPos[1];
      const dist = Math.hypot(dx, dy);

      if (dist > maxDistance) {
        return; // Too far to hear
      }

      distanceGain = 1.0 / (1.0 + Math.pow(dist / refDistance, 2));
      // Pan left (-1.0) to right (+1.0) based on horizontal offset relative to refDistance
      stereoPan = Math.max(-1.0, Math.min(1.0, dx / (refDistance * 1.5)));
    }

    const finalGain = Math.max(0, Math.min(1.0, distanceGain * volumeMultiplier));
    if (finalGain <= 0.001) return;

    try {
      const source = this.ctx.createBufferSource();
      source.buffer = buffer;

      const gainNode = this.ctx.createGain();
      gainNode.gain.value = finalGain;

      // Stereo panner if supported
      if (typeof this.ctx.createStereoPanner === 'function') {
        const panner = this.ctx.createStereoPanner();
        panner.pan.value = stereoPan;
        source.connect(gainNode);
        gainNode.connect(panner);
        panner.connect(this.sfxGain);
      } else {
        source.connect(gainNode);
        gainNode.connect(this.sfxGain);
      }

      source.start();
    } catch (err) {
      console.warn(`[AudioEngine] Failed to play spatial sound ${soundUrl}:`, err);
    }
  }

  /**
   * Play weapon fire sound variant.
   */
  public async playWeaponFire(fireSound: string, worldX?: number, worldY?: number): Promise<void> {
    const variants = WEAPON_SHOT_VARIANTS[fireSound] || [
      `/vfs/sound/weapon/shot/${fireSound.replace(/\/$/, '')}.wav`,
    ];
    const chosen = variants[Math.floor(Math.random() * variants.length)];
    await this.playSpatialSound(chosen, worldX, worldY, 0.9, 3500, 600);
  }

  /**
   * Play detonation / explosion sound.
   */
  public async playExplosion(
    kind: 'small' | 'medium' | 'big' | 'artillery' = 'medium',
    worldX?: number,
    worldY?: number
  ): Promise<void> {
    const list = DETONATION_VARIANTS[kind] || DETONATION_VARIANTS.medium;
    const chosen = list[Math.floor(Math.random() * list.length)];
    await this.playSpatialSound(chosen, worldX, worldY, 1.0, 5000, 800);
  }

  /**
   * Play UI button click, tab switch, or mission alert.
   */
  public async playUI(soundKey: 'click' | 'select' | 'alert' = 'click'): Promise<void> {
    const url = `/vfs/sound/gui/${soundKey}.wav`;
    const buffer = await this.loadAudio(url);
    if (!buffer || !this.ctx || !this.uiGain) {
      // Synthetic oscillator click fallback if wav not present
      this.playSyntheticClick();
      return;
    }

    try {
      const source = this.ctx.createBufferSource();
      source.buffer = buffer;
      source.connect(this.uiGain);
      source.start();
    } catch (_) {
      this.playSyntheticClick();
    }
  }

  private playSyntheticClick() {
    if (!this.ctx || !this.uiGain) return;
    try {
      const osc = this.ctx.createOscillator();
      const gain = this.ctx.createGain();
      osc.type = 'sine';
      osc.frequency.setValueAtTime(600, this.ctx.currentTime);
      osc.frequency.exponentialRampToValueAtTime(150, this.ctx.currentTime + 0.04);
      gain.gain.setValueAtTime(0.15, this.ctx.currentTime);
      gain.gain.linearRampToValueAtTime(0.001, this.ctx.currentTime + 0.04);
      osc.connect(gain);
      gain.connect(this.uiGain);
      osc.start();
      osc.stop(this.ctx.currentTime + 0.04);
    } catch (_) {}
  }

  /**
   * Bind event listeners to World simulation to trigger real-time game audio autonomously.
   */
  public attachToWorld(world: World): void {
    // 1. Weapon fire
    world.eventBus.on('combat:fire', (ev: any) => {
      const data = ev.data || {};
      const sound = data.fireSound || 'rifle/m1_shot';
      this.playWeaponFire(sound, data.x, data.y);
    });

    // 2. Weapon impact / hit
    world.eventBus.on('combat:hit', (ev: any) => {
      const data: HitResult = ev.data;
      if (data && data.penetrated && (data.targetKilled || data.damageDealt > 80)) {
        this.playExplosion('small', data.point[0], data.point[1]);
      }
    });

    // 3. Reinforcement dispatch horn / alert
    world.eventBus.on('reinforcement:called', () => {
      this.playUI('alert');
    });

    // 4. Update camera listener position on world pan
    // Expose listener update method
  }

  public setMasterVolume(v: number) {
    this.masterVolume = Math.max(0, Math.min(1, v));
    if (this.masterGain && this.ctx) {
      this.masterGain.gain.setValueAtTime(this.isMuted ? 0 : this.masterVolume, this.ctx.currentTime);
    }
  }

  public setMusicVolume(v: number) {
    this.musicVolume = Math.max(0, Math.min(1, v));
    if (this.musicGain && this.ctx) {
      this.musicGain.gain.setValueAtTime(this.musicVolume, this.ctx.currentTime);
    }
  }

  public setSfxVolume(v: number) {
    this.sfxVolume = Math.max(0, Math.min(1, v));
    if (this.sfxGain && this.ctx) {
      this.sfxGain.gain.setValueAtTime(this.sfxVolume, this.ctx.currentTime);
    }
  }

  public toggleMute(): boolean {
    this.isMuted = !this.isMuted;
    if (this.masterGain && this.ctx) {
      this.masterGain.gain.setValueAtTime(this.isMuted ? 0 : this.masterVolume, this.ctx.currentTime);
    }
    return this.isMuted;
  }
}
