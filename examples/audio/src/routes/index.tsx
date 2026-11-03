import {
  DownloadSimpleIcon,
  FileAudioIcon,
  MicrophoneIcon,
  PlayIcon,
  RecordIcon,
  StopIcon,
  WarningIcon,
  WaveformIcon,
} from "@phosphor-icons/react";
import { createFileRoute } from "@tanstack/react-router";
import { createAudioRecordingFileName } from "@temelj/audio";
import * as React from "react";

import type { InputKind } from "@/lib/engine";
import type { TypeDiagnostic } from "@/lib/typecheck";

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button, LinkButton } from "@/components/ui/button";
import {
  Card,
  CardAction,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@/components/ui/empty";
import { Field, FieldLabel } from "@/components/ui/field";
import { Kbd, KbdGroup } from "@/components/ui/kbd";
import { Progress, ProgressLabel, ProgressValue } from "@/components/ui/progress";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Slider } from "@/components/ui/slider";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import { Visualizer } from "@/components/visualizer";
import { ProgramError, compileProgram, errorMessage } from "@/lib/compile";
import { PlaygroundEngine } from "@/lib/engine";
import { DEFAULT_PRESET, PRESETS } from "@/lib/presets";
import { TypeChecker } from "@/lib/typecheck";

export const Route = createFileRoute("/")({ component: Playground });

type Problem = {
  readonly title: string;
  readonly message: string;
};

type TypeState =
  | { readonly status: "idle" }
  | { readonly status: "checking" }
  | { readonly status: "checked"; readonly diagnostics: readonly TypeDiagnostic[] }
  | { readonly status: "failed"; readonly message: string };

type Recording = {
  readonly url: string;
  readonly fileName: string;
};

const INDENT = "  ";

const MIN_LEVEL_DB = -60;

function Playground() {
  const engineRef = React.useRef<PlaygroundEngine | null>(null);
  const checkerRef = React.useRef<TypeChecker | null>(null);
  const fileInputRef = React.useRef<HTMLInputElement>(null);
  const [presetId, setPresetId] = React.useState(DEFAULT_PRESET.id);
  const [code, setCode] = React.useState(DEFAULT_PRESET.code);
  const [input, setInput] = React.useState<InputKind>("demo");
  const [fileName, setFileName] = React.useState<string>();
  const [running, setRunning] = React.useState(false);
  const [busy, setBusy] = React.useState(false);
  const [problem, setProblem] = React.useState<Problem>();
  const [types, setTypes] = React.useState<TypeState>({ status: "idle" });
  const [graph, setGraph] = React.useState<string>();
  const [volume, setVolume] = React.useState(0.8);
  const [level, setLevel] = React.useState(Number.NEGATIVE_INFINITY);
  const [recording, setRecording] = React.useState(false);
  const [take, setTake] = React.useState<Recording>();

  const supported = React.useSyncExternalStore(
    subscribeToNothing,
    () => PlaygroundEngine.isSupported(),
    () => true,
  );

  React.useEffect(() => {
    return () => {
      void engineRef.current?.dispose();
      checkerRef.current?.dispose();
    };
  }, []);

  React.useEffect(() => {
    return () => {
      if (take !== undefined) {
        URL.revokeObjectURL(take.url);
      }
    };
  }, [take]);

  // Type-check as you type, debounced. The checker loads TypeScript in a worker on first use.
  React.useEffect(() => {
    const timer = setTimeout(() => {
      checkerRef.current ??= new TypeChecker();
      const checker = checkerRef.current;
      setTypes({ status: "checking" });

      void checker.check(code).then((response) => {
        if (!checker.isLatest(response.id)) {
          return;
        }

        setTypes(
          "error" in response
            ? { message: response.error, status: "failed" }
            : { diagnostics: response.diagnostics, status: "checked" },
        );
      });
    }, 400);

    return () => clearTimeout(timer);
  }, [code]);

  const engine = React.useCallback(() => {
    engineRef.current ??= new PlaygroundEngine();

    return engineRef.current;
  }, []);

  const getAnalyser = React.useCallback(() => engineRef.current?.analyser, []);

  async function run(source: string = code) {
    setBusy(true);
    setProblem(undefined);

    try {
      const result = await engine().run(compileProgram(source));
      setGraph(result.graph);
      setRunning(true);
    } catch (error) {
      engine().stop();
      setRunning(false);
      setRecording(false);
      setProblem(describeProblem(error));
    } finally {
      setBusy(false);
    }
  }

  function stop() {
    engineRef.current?.stop();
    setRunning(false);
    setRecording(false);
    setLevel(Number.NEGATIVE_INFINITY);
  }

  async function selectInput(next: InputKind) {
    if (next === "file" && engineRef.current?.fileName === undefined) {
      setInput("file");

      return;
    }

    setBusy(true);
    setProblem(undefined);

    try {
      if (next === "microphone") {
        await engine().useMicrophone();
      } else if (next === "demo") {
        await engine().useDemo();
      }

      setInput(next);

      if (running) {
        await run();
      }
    } catch (error) {
      setProblem({ message: errorMessage(error), title: "Could not open the microphone" });
    } finally {
      setBusy(false);
    }
  }

  async function selectFile(file: File | undefined) {
    if (file === undefined) {
      return;
    }

    setBusy(true);
    setProblem(undefined);

    try {
      await engine().useFile(file);
      setFileName(file.name);
      setInput("file");

      if (running) {
        await run();
      }
    } catch (error) {
      setProblem({ message: errorMessage(error), title: "Could not decode that file" });
    } finally {
      setBusy(false);
    }
  }

  function selectPreset(id: string) {
    const preset = PRESETS.find((candidate) => candidate.id === id);

    if (preset === undefined) {
      return;
    }

    setPresetId(preset.id);
    setCode(preset.code);

    if (running) {
      void run(preset.code);
    }
  }

  function changeVolume(next: number) {
    setVolume(next);
    engineRef.current?.setVolume(next);
  }

  async function toggleRecording() {
    if (!recording) {
      await engine().startRecording();
      setRecording(engine().isRecording);

      return;
    }

    const blob = await engine().stopRecording();
    setRecording(false);

    if (blob !== undefined) {
      setTake({
        fileName: createAudioRecordingFileName(blob.type, { name: "playground-take" }),
        url: URL.createObjectURL(blob),
      });
    }
  }

  function handleEditorKeyDown(event: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) {
      event.preventDefault();
      void run();

      return;
    }

    if (event.key === "Tab" && !event.shiftKey) {
      event.preventDefault();
      const textarea = event.currentTarget;
      const { selectionEnd, selectionStart } = textarea;
      setCode(code.slice(0, selectionStart) + INDENT + code.slice(selectionEnd));
      setPresetId("");
      requestAnimationFrame(() => {
        textarea.selectionStart = textarea.selectionEnd = selectionStart + INDENT.length;
      });
    }
  }

  const preset = PRESETS.find((candidate) => candidate.id === presetId);
  const diagnostics = types.status === "checked" ? types.diagnostics : [];
  const levelPercent = Math.max(0, Math.min(100, ((level - MIN_LEVEL_DB) / -MIN_LEVEL_DB) * 100));

  return (
    <main className="container mx-auto flex flex-col gap-6 p-6">
      <header className="flex flex-col gap-1">
        <h1 className="text-2xl font-semibold">@temelj/audio playground</h1>
      </header>

      {!supported && (
        <Alert variant="destructive">
          <WarningIcon />
          <AlertTitle>Web Audio is not available</AlertTitle>
          <AlertDescription>
            This browser has no AudioContext, so nothing can play.
          </AlertDescription>
        </Alert>
      )}

      <div className="grid items-start gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>Program</CardTitle>
            <CardDescription>{preset?.description ?? "Your own program."}</CardDescription>
            <CardAction>
              <Select
                aria-label="Preset"
                onSelectionChange={(key) => selectPreset(String(key))}
                placeholder="Custom"
                selectedKey={presetId}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {PRESETS.map((candidate) => (
                    <SelectItem key={candidate.id} id={candidate.id}>
                      {candidate.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </CardAction>
          </CardHeader>
          <CardContent className="flex flex-col gap-4">
            <Textarea
              aria-label="Program source"
              className="font-mono"
              onChange={(event) => {
                setCode(event.target.value);
                setPresetId("");
              }}
              onKeyDown={handleEditorKeyDown}
              rows={18}
              spellCheck={false}
              value={code}
            />
            {diagnostics.length > 0 && (
              <Alert variant="destructive">
                <WarningIcon />
                <AlertTitle>
                  {diagnostics.length} type {diagnostics.length === 1 ? "error" : "errors"}
                </AlertTitle>
                <AlertDescription>
                  <ul>
                    {diagnostics.map((diagnostic, index) => (
                      <li key={index}>
                        {diagnostic.line === undefined
                          ? diagnostic.message
                          : `Line ${diagnostic.line}: ${diagnostic.message}`}
                      </li>
                    ))}
                  </ul>
                </AlertDescription>
              </Alert>
            )}
            {problem !== undefined && (
              <Alert variant="destructive">
                <WarningIcon />
                <AlertTitle>{problem.title}</AlertTitle>
                <AlertDescription>{problem.message}</AlertDescription>
              </Alert>
            )}
          </CardContent>
          <CardFooter className="gap-2">
            <Button isDisabled={busy || !supported} onPress={() => void run()}>
              <PlayIcon />
              {running ? "Re-run" : "Run"}
            </Button>
            <Button isDisabled={!running} onPress={stop} variant="outline">
              <StopIcon />
              Stop
            </Button>
            <KbdGroup>
              <Kbd>⌘</Kbd>
              <Kbd>Enter</Kbd>
            </KbdGroup>
            <TypeStatus state={types} />
          </CardFooter>
        </Card>

        <div className="flex flex-col gap-6">
          <Card>
            <CardHeader>
              <CardTitle>Input</CardTitle>
              <CardDescription>What the program processes.</CardDescription>
            </CardHeader>
            <CardContent>
              <Tabs
                onSelectionChange={(key) => {
                  if (isInputKind(key)) {
                    void selectInput(key);
                  }
                }}
                selectedKey={input}
              >
                <TabsList>
                  <TabsTrigger id="demo">
                    <WaveformIcon />
                    Demo loop
                  </TabsTrigger>
                  <TabsTrigger id="microphone">
                    <MicrophoneIcon />
                    Microphone
                  </TabsTrigger>
                  <TabsTrigger id="file">
                    <FileAudioIcon />
                    File
                  </TabsTrigger>
                </TabsList>
                <TabsContent id="demo">
                  <p className="text-muted-foreground">
                    A plucked arpeggio rendered offline with <code>renderOffline()</code>.
                  </p>
                </TabsContent>
                <TabsContent id="microphone">
                  <p className="text-muted-foreground">
                    Live microphone input. Use headphones to avoid feedback.
                  </p>
                </TabsContent>
                <TabsContent id="file" className="flex items-center gap-3">
                  <Button onPress={() => fileInputRef.current?.click()} variant="outline">
                    <FileAudioIcon />
                    Choose file
                  </Button>
                  <span className="text-muted-foreground">{fileName ?? "No file chosen"}</span>
                  <input
                    ref={fileInputRef}
                    accept="audio/*"
                    hidden
                    onChange={(event) => {
                      void selectFile(event.target.files?.[0]);
                      event.target.value = "";
                    }}
                    type="file"
                  />
                </TabsContent>
              </Tabs>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Output</CardTitle>
              <CardDescription>Spectrum and waveform after the program.</CardDescription>
              <CardAction>
                <Badge variant={running ? "default" : "outline"}>
                  {running ? "Playing" : "Stopped"}
                </Badge>
              </CardAction>
            </CardHeader>
            <CardContent className="flex flex-col gap-6">
              <Visualizer getAnalyser={getAnalyser} onLevel={setLevel} />
              <Progress
                aria-label="Level"
                value={levelPercent}
                valueLabel={levelPercent > 0 ? `${level.toFixed(1)} dB` : "−∞ dB"}
              >
                <ProgressLabel>Level</ProgressLabel>
                <ProgressValue />
              </Progress>
              <Field>
                <FieldLabel>Volume</FieldLabel>
                <Slider
                  aria-label="Volume"
                  maxValue={1}
                  minValue={0}
                  onChange={changeVolume}
                  step={0.01}
                  value={volume}
                />
              </Field>
            </CardContent>
            <CardFooter className="gap-2">
              <Button
                isDisabled={!running}
                onPress={() => void toggleRecording()}
                variant={recording ? "destructive" : "outline"}
              >
                <RecordIcon />
                {recording ? "Stop recording" : "Record output"}
              </Button>
              {take !== undefined && !recording && (
                <>
                  <audio controls src={take.url} />
                  <LinkButton download={take.fileName} href={take.url} variant="ghost">
                    <DownloadSimpleIcon />
                    Download
                  </LinkButton>
                </>
              )}
            </CardFooter>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Graph</CardTitle>
              <CardDescription>The last run, as described by inspectGraph().</CardDescription>
            </CardHeader>
            <CardContent>
              {graph === undefined ? (
                <Empty>
                  <EmptyHeader>
                    <EmptyMedia variant="icon">
                      <WaveformIcon />
                    </EmptyMedia>
                    <EmptyTitle>No graph yet</EmptyTitle>
                    <EmptyDescription>Run the program to inspect its graph.</EmptyDescription>
                  </EmptyHeader>
                </Empty>
              ) : (
                <ScrollArea className="max-h-64">
                  <pre className="font-mono text-xs">{graph}</pre>
                </ScrollArea>
              )}
            </CardContent>
          </Card>
        </div>
      </div>
    </main>
  );
}

function TypeStatus({ state }: { state: TypeState }) {
  switch (state.status) {
    case "idle":
      return null;
    case "checking":
      return <Badge variant="outline">Checking types…</Badge>;
    case "failed":
      return <Badge variant="outline">Type check unavailable</Badge>;
    case "checked":
      return state.diagnostics.length === 0 ? (
        <Badge variant="secondary">Types OK</Badge>
      ) : (
        <Badge variant="destructive">Type errors</Badge>
      );
  }
}

function subscribeToNothing(): () => void {
  return () => undefined;
}

function isInputKind(key: React.Key): key is InputKind {
  return key === "demo" || key === "microphone" || key === "file";
}

function describeProblem(error: unknown): Problem {
  const message = errorMessage(error);

  if (error instanceof ProgramError) {
    return {
      message,
      title: error.phase === "compile" ? "The program does not compile" : "The program failed",
    };
  }

  return { message, title: "The program failed" };
}
