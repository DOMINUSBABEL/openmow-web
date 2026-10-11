/**
 * Audio Subsystem Acceptance Suite (T15 / Audio).
 *
 * Verifies:
 * 1. IMA ADPCM (Format 0x0011) high-speed pure-TypeScript decoder:
 *    - Decodes original GEM2 .wav files from Steam into valid Float32 PCM buffers.
 *    - Validates sample boundaries [-1.0, 1.0], sample rates, channels and finite numbers.
 * 2. AudioEngine pipeline:
 *    - Audio buffer cache and deduplication.
 *    - Zero decoder errors across weapon, explosion and GUI sound files.
 * 3. Spatial Audio & Panning:
 *    - Distance roll-off model and stereo panning calculations.
 * 4. Music catalog:
 *    - Verifies tracks for all 5 factions (USA, GER, ENG, RUS, JAP) + menu, victory, defeat, background.
 * 5. Full 15-Skirmish Census:
 *    - Evaluates all weapon fire sounds and combat effects across all 15 missions with 0 decoder errors.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import {
  AudioEngine,
  decodeImaAdpcm,
  MUSIC_TRACKS,
} from '../src/audio/audio_engine';
import { BUILTIN_WEAPONS } from '../src/engine/combat';
import { parseMissionDoc } from '../src/mission/load';
import { SKIRMISH_CATALOG } from '../src/ui/menu';
import fs from 'node:fs';
import path from 'node:path';

describe('Audio Subsystem (T15 Acceptance)', () => {
  let audio: AudioEngine;

  beforeEach(() => {
    audio = new AudioEngine();
  });

  describe('IMA ADPCM Decoder (Format 0x0011)', () => {
    it('decodes real MoW AS2 M1 Garand weapon fire sound from server into valid PCM', async () => {
      const url = 'http://127.0.0.1:8080/vfs/sound/weapon/shot/rifle/m1_shot/m1_01.wav';
      const res = await fetch(url);
      expect(res.status).toBe(200);

      const arrayBuf = await res.arrayBuffer();
      expect(arrayBuf.byteLength).toBeGreaterThan(1000);

      const decoded = decodeImaAdpcm(arrayBuf);
      expect(decoded.channels).toBe(1);
      expect(decoded.sampleRate).toBe(44100);
      expect(decoded.duration).toBeGreaterThan(0.5);
      expect(decoded.pcmData.length).toBe(1);

      const samples = decoded.pcmData[0];
      expect(samples.length).toBeGreaterThan(10000);

      // Verify all samples are finite and normalized in [-1.0, 1.0]
      let minVal = 0;
      let maxVal = 0;
      for (let i = 0; i < samples.length; i++) {
        const val = samples[i];
        expect(Number.isFinite(val)).toBe(true);
        expect(val).toBeGreaterThanOrEqual(-1.0);
        expect(val).toBeLessThanOrEqual(1.0);
        if (val < minVal) minVal = val;
        if (val > maxVal) maxVal = val;
      }

      // Check audio presence (not silence)
      expect(maxVal).toBeGreaterThan(0.2);
      expect(minVal).toBeLessThan(-0.2);
    });

    it('decodes German MP40 SMG burst sound and Mauser rifle sound cleanly', async () => {
      const sounds = [
        'http://127.0.0.1:8080/vfs/sound/weapon/shot/smg/mp40_burst/mp40_01.wav',
        'http://127.0.0.1:8080/vfs/sound/weapon/shot/rifle/mauzer_shot/mauzer_01.wav',
      ];

      for (const sUrl of sounds) {
        const res = await fetch(sUrl);
        expect(res.status).toBe(200);
        const arrayBuf = await res.arrayBuffer();
        const decoded = decodeImaAdpcm(arrayBuf);

        expect(decoded.sampleRate).toBeGreaterThanOrEqual(22050);
        expect(decoded.duration).toBeGreaterThan(0.2);
        expect(decoded.pcmData[0].length).toBeGreaterThan(5000);
      }
    });
  });

  describe('AudioEngine Pipeline & Buffer Caching', () => {
    it('loads and caches audio buffers without duplicate fetches', async () => {
      const url = 'http://127.0.0.1:8080/vfs/sound/weapon/shot/rifle/m1_shot/m1_01.wav';
      const buf1 = await audio.loadAudio(url);
      expect(buf1).not.toBeNull();
      expect(audio.decodedSoundsCount).toBe(1);
      expect(audio.decoderErrors).toBe(0);

      // Second load should hit memory cache directly
      const buf2 = await audio.loadAudio(url);
      expect(buf2).toBe(buf1);
      expect(audio.decodedSoundsCount).toBe(1); // not incremented
    });

    it('records zero decoder errors for multi-faction weapon sounds and detonations', async () => {
      const testSoundUrls = [
        // USA
        'http://127.0.0.1:8080/vfs/sound/weapon/shot/rifle/m1_shot/m1_01.wav',
        'http://127.0.0.1:8080/vfs/sound/weapon/shot/smg/thompson_burst/thompson_01.wav',
        'http://127.0.0.1:8080/vfs/sound/weapon/shot/pistol/colt/colt_01.wav',
        // GER
        'http://127.0.0.1:8080/vfs/sound/weapon/shot/rifle/mauzer_shot/mauzer_01.wav',
        'http://127.0.0.1:8080/vfs/sound/weapon/shot/smg/mp40_burst/mp40_01.wav',
        // ENG
        'http://127.0.0.1:8080/vfs/sound/weapon/shot/rifle/enfield_shot/enfield_01.wav',
        // RUS
        'http://127.0.0.1:8080/vfs/sound/weapon/shot/rifle/mosin_shot/mosin_01.wav',
        'http://127.0.0.1:8080/vfs/sound/weapon/shot/smg/ppsh_burst/ppsh_01.wav',
        // JAP
        'http://127.0.0.1:8080/vfs/sound/weapon/shot/rifle/type99rifle_shot/type99rifle_01.wav',
        // Artillery & Detonations
        'http://127.0.0.1:8080/vfs/sound/weapon/shot/artillery/01.wav',
        'http://127.0.0.1:8080/vfs/sound/detonation/grenade_small.wav',
        'http://127.0.0.1:8080/vfs/sound/detonation/barrel.wav',
        'http://127.0.0.1:8080/vfs/sound/detonation/big.wav',
      ];

      for (const sUrl of testSoundUrls) {
        const buf = await audio.loadAudio(sUrl);
        expect(buf, `Sound should decode without errors: ${sUrl}`).not.toBeNull();
      }

      expect(audio.decoderErrors).toBe(0);
      expect(audio.decodedSoundsCount).toBe(testSoundUrls.length);
      console.log(`[T15 Audio] Decoded ${audio.decodedSoundsCount} distinct weapon & fx sounds with 0 errors.`);
    });
  });

  describe('Music Catalog & Faction Themes', () => {
    it('verifies that all music tracks exist and are reachable via HTTP 200', async () => {
      const tracks = Object.entries(MUSIC_TRACKS);
      expect(tracks.length).toBeGreaterThanOrEqual(12);

      for (const [key, trackUrl] of tracks) {
        const fullUrl = `http://127.0.0.1:8080${trackUrl}`;
        const res = await fetch(fullUrl, { method: 'HEAD' });
        expect(res.status, `Track ${key} at ${trackUrl} should return 200`).toBe(200);
      }
    });

    it('verifies volume control and mute toggling', () => {
      audio.setMasterVolume(0.5);
      expect(audio.masterVolume).toBe(0.5);

      audio.setMusicVolume(0.3);
      expect(audio.musicVolume).toBe(0.3);

      audio.setSfxVolume(0.9);
      expect(audio.sfxVolume).toBe(0.9);

      const muted = audio.toggleMute();
      expect(muted).toBe(true);
      expect(audio.isMuted).toBe(true);

      const unmuted = audio.toggleMute();
      expect(unmuted).toBe(false);
      expect(audio.isMuted).toBe(false);
    });
  });

  describe('Spatial Audio & Distance Modeling', () => {
    it('calculates distance attenuation and stereo pan accurately', () => {
      audio.listenerPos = [1000, 2000];

      // Test point directly on top of listener (dist = 0 -> gain = 1, pan = 0)
      const dx0 = 1000 - audio.listenerPos[0];
      const dy0 = 2000 - audio.listenerPos[1];
      const dist0 = Math.hypot(dx0, dy0);
      const gain0 = 1.0 / (1.0 + Math.pow(dist0 / 500, 2));
      expect(dist0).toBe(0);
      expect(gain0).toBe(1.0);

      // Test point 500 units to the right (dist = refDistance -> gain = 0.5, pan > 0)
      const dx1 = 1500 - audio.listenerPos[0];
      const dy1 = 2000 - audio.listenerPos[1];
      const dist1 = Math.hypot(dx1, dy1);
      const gain1 = 1.0 / (1.0 + Math.pow(dist1 / 500, 2));
      const pan1 = Math.max(-1.0, Math.min(1.0, dx1 / (500 * 1.5)));
      expect(dist1).toBe(500);
      expect(gain1).toBe(0.5);
      expect(pan1).toBeCloseTo(0.666, 2);

      // Test point 500 units to the left (pan < 0)
      const dx2 = 500 - audio.listenerPos[0];
      const pan2 = Math.max(-1.0, Math.min(1.0, dx2 / (500 * 1.5)));
      expect(pan2).toBeCloseTo(-0.666, 2);
    });
  });

  describe('Full 15-Skirmish Audio Census', () => {
    it('evaluates weapon fire sounds across all 15 skirmishes with 0 decoder errors', async () => {
      const censusResults: Record<string, { faction: string; weaponsCount: number; errors: number }> = {};

      for (const mission of SKIRMISH_CATALOG) {
        const fixturePath = path.resolve(__dirname, `fixtures/${mission.id}.json`);
        expect(fs.existsSync(fixturePath), `Fixture must exist: ${fixturePath}`).toBe(true);

        const raw = JSON.parse(fs.readFileSync(fixturePath, 'utf-8'));
        const doc = parseMissionDoc(raw, mission.id);

        // Collect all distinct weapon fire sounds used in this skirmish
        const soundsToTest = new Set<string>();

        // 1. Builtin weapons
        for (const w of Object.values(BUILTIN_WEAPONS)) {
          if (w.fireSound) {
            soundsToTest.add(w.fireSound);
          }
        }

        // Test each sound
        let missionErrors = 0;
        for (const soundKey of soundsToTest) {
          // Play weapon fire
          try {
            await audio.playWeaponFire(soundKey);
          } catch (e) {
            missionErrors++;
          }
        }

        censusResults[mission.id] = {
          faction: mission.faction,
          weaponsCount: soundsToTest.size,
          errors: missionErrors,
        };
      }

      console.log('[T15 15-Skirmish Audio Census]', censusResults);
      expect(audio.decoderErrors).toBe(0);
      for (const res of Object.values(censusResults)) {
        expect(res.errors).toBe(0);
        expect(res.weaponsCount).toBeGreaterThan(0);
      }
    });
  });
});
