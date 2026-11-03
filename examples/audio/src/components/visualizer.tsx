import { getFrequencyData, getRmsDb, getWaveformData } from "@temelj/audio";
import * as React from "react";

type VisualizerProps = {
  /** Read every frame, so the visualizer follows the engine across runs. */
  readonly getAnalyser: () => AnalyserNode | undefined;
  /** Called about ten times a second with the output level in dBFS. */
  readonly onLevel: (levelDb: number) => void;
};

type CanvasSize = {
  readonly width: number;
  readonly height: number;
};

const LEVEL_INTERVAL_MS = 100;

/**
 * Draws the output spectrum with the waveform on top, using the theme's chart colors.
 */
export function Visualizer({ getAnalyser, onLevel }: VisualizerProps) {
  const canvasRef = React.useRef<HTMLCanvasElement>(null);

  React.useEffect(() => {
    const canvas = canvasRef.current;
    const context = canvas?.getContext("2d");

    if (canvas === null || context === null || context === undefined) {
      return;
    }

    let frame = 0;
    let lastLevel = 0;
    let spectrum: Uint8Array<ArrayBuffer> | undefined;
    let waveform: Float32Array<ArrayBuffer> | undefined;

    const draw = (now: number) => {
      frame = requestAnimationFrame(draw);
      const { width, height } = resize(canvas);
      context.clearRect(0, 0, width, height);

      const analyser = getAnalyser();

      if (analyser === undefined) {
        return;
      }

      if (spectrum?.length !== analyser.frequencyBinCount) {
        spectrum = new Uint8Array(analyser.frequencyBinCount);
        waveform = new Float32Array(analyser.fftSize);
      }

      getFrequencyData(analyser, { target: spectrum });
      getWaveformData(analyser, { target: waveform });

      const styles = getComputedStyle(canvas);
      drawSpectrum(context, spectrum, width, height, styles.getPropertyValue("--chart-2"));
      drawWaveform(context, waveform!, width, height, styles.getPropertyValue("--foreground"));

      if (now - lastLevel > LEVEL_INTERVAL_MS) {
        lastLevel = now;
        onLevel(getRmsDb(analyser, { target: waveform }));
      }
    };

    frame = requestAnimationFrame(draw);

    return () => cancelAnimationFrame(frame);
  }, [getAnalyser, onLevel]);

  return <canvas ref={canvasRef} className="bg-muted h-40 w-full rounded-md" />;
}

function resize(canvas: HTMLCanvasElement): CanvasSize {
  const ratio = window.devicePixelRatio || 1;
  const width = Math.floor(canvas.clientWidth * ratio);
  const height = Math.floor(canvas.clientHeight * ratio);

  if (canvas.width !== width || canvas.height !== height) {
    canvas.width = width;
    canvas.height = height;
  }

  return { height, width };
}

function drawSpectrum(
  context: CanvasRenderingContext2D,
  spectrum: Uint8Array,
  width: number,
  height: number,
  color: string,
) {
  // Log-spaced bars, so low frequencies get as much room as high ones.
  const bars = 96;
  const barWidth = width / bars;
  context.fillStyle = color;

  for (let bar = 0; bar < bars; bar++) {
    const index = Math.min(spectrum.length - 1, Math.floor(spectrum.length ** (bar / bars)));
    const barHeight = ((spectrum[index] ?? 0) / 255) * height;
    context.fillRect(bar * barWidth + 1, height - barHeight, barWidth - 2, barHeight);
  }
}

function drawWaveform(
  context: CanvasRenderingContext2D,
  waveform: Float32Array,
  width: number,
  height: number,
  color: string,
) {
  context.strokeStyle = color;
  context.lineWidth = window.devicePixelRatio || 1;
  context.beginPath();

  for (let index = 0; index < waveform.length; index++) {
    const x = (index / (waveform.length - 1)) * width;
    const y = (1 - (waveform[index] ?? 0)) * (height / 2);

    if (index === 0) {
      context.moveTo(x, y);
    } else {
      context.lineTo(x, y);
    }
  }

  context.stroke();
}
