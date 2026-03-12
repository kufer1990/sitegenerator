import { spawn } from "node:child_process";
import * as fs from "node:fs/promises";
import * as path from "node:path";

type CodexRunResult = {
  stdout: string;
  stderr: string;
  exitCode: number;
  command: string;
  lastMessage: string;
};

type StageInput = {
  [key: string]: unknown;
  pages?: unknown[];
};

type ChunkPlanItem = {
  index: number;
  startPage: number;
  endPage: number;
  pagesCount: number;
  bytes: number;
};

type ChunkBundle = {
  plan: ChunkPlanItem[];
  chunks: unknown[][];
};

const PROMPT_FILE_REL = "ai/prompts/03-analysis.md";
const INPUT_JSON_REL = "output/03-enriched-site-data.json";
const OUTPUT_MD_REL = "output/04-ai-analysis.md";
const OUTPUT_RAW_REL = "output/04-ai-analysis.raw.txt";
const CHUNKS_DIR_REL = "output/04-chunks";
const LAST_MESSAGE_TMP_REL = "output/.tmp-04-last-message.txt";
const LEGACY_LAST_MESSAGE_TMP_REL = "output/.tmp-04-ai-analysis-last-message.txt";

const CODEX_BIN = process.env.CODEX_BIN?.trim() || "codex";
const STREAM_CLI_OUTPUT =
  process.env.STAGE4_STREAM_CLI_OUTPUT
    ? process.env.STAGE4_STREAM_CLI_OUTPUT !== "0"
    : process.env.STAGE3_STREAM_CLI_OUTPUT !== "0";
const HEARTBEAT_MS = Number(process.env.STAGE4_HEARTBEAT_MS || process.env.STAGE3_HEARTBEAT_MS || 15000);
const MAX_CHUNK_BYTES = Number(process.env.STAGE4_MAX_CHUNK_BYTES || 80000);
const MAX_PAGES_PER_CHUNK = Number(process.env.STAGE4_MAX_PAGES_PER_CHUNK || 16);
const DRY_RUN = process.env.STAGE4_DRY_RUN === "1";
const KEEP_ARTIFACTS = process.env.STAGE4_KEEP_ARTIFACTS === "1";

function logStep(message: string): void {
  console.log(`[stage4] ${message}`);
}

function logCli(channel: "stdout" | "stderr", chunk: string): void {
  if (!STREAM_CLI_OUTPUT) return;

  const lines = chunk.replace(/\r/g, "\n").split("\n");
  for (const line of lines) {
    const cleanLine = line.trim();
    if (!cleanLine) continue;
    console.log(`[stage4][codex:${channel}] ${cleanLine}`);
  }
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
}

function formatDurationMs(ms: number): string {
  const seconds = Math.floor(ms / 1000);
  const mins = Math.floor(seconds / 60);
  const remSec = seconds % 60;
  return `${mins}m ${remSec}s`;
}

function fail(message: string): never {
  throw new Error(message);
}

function byteLength(value: string): number {
  return Buffer.byteLength(value, "utf-8");
}

function toJsonMin(value: unknown): string {
  return JSON.stringify(value);
}

function toJsonPretty(value: unknown): string {
  return JSON.stringify(value, null, 2);
}

function getPages(input: StageInput): unknown[] {
  return Array.isArray(input.pages) ? input.pages : [];
}

function estimateBytes(value: unknown): number {
  return byteLength(toJsonMin(value));
}

async function fileExists(filePath: string): Promise<boolean> {
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
}

async function assertFileExists(filePath: string, label: string): Promise<void> {
  if (!(await fileExists(filePath))) {
    fail(`Brak pliku ${label}: ${filePath}`);
  }
}

async function readTextFile(filePath: string, label: string): Promise<string> {
  try {
    return await fs.readFile(filePath, "utf-8");
  } catch (error) {
    const message = error instanceof Error ? error.message : "unknown error";
    fail(`Nie mozna odczytac ${label}: ${filePath}\nSzczegoly: ${message}`);
  }
}

async function writeTextFile(filePath: string, content: string): Promise<void> {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, content, "utf-8");
}

async function cleanupTmpFiles(cwd: string): Promise<void> {
  const tmpFiles = [
    path.resolve(cwd, LAST_MESSAGE_TMP_REL),
    path.resolve(cwd, LEGACY_LAST_MESSAGE_TMP_REL),
  ];

  await Promise.all(tmpFiles.map(filePath => fs.rm(filePath, { force: true })));
}

async function cleanupChunksDir(chunksDir: string): Promise<void> {
  await fs.rm(chunksDir, { recursive: true, force: true });
}

function buildRawLog(title: string, result: CodexRunResult): string {
  return [
    `title: ${title}`,
    `generatedAt: ${new Date().toISOString()}`,
    `command: ${result.command}`,
    `exitCode: ${result.exitCode}`,
    "",
    "===== STDOUT =====",
    result.stdout || "(empty)",
    "",
    "===== STDERR =====",
    result.stderr || "(empty)",
    "",
  ].join("\n");
}

async function runCodexCli(
  finalPrompt: string,
  workdir: string,
  lastMessagePath: string,
): Promise<CodexRunResult> {
  const args = [
    "exec",
    "--color",
    "never",
    "--sandbox",
    "read-only",
    "--output-last-message",
    lastMessagePath,
    "-",
  ];
  const command = `${CODEX_BIN} ${args.join(" ")}`;

  await fs.mkdir(path.dirname(lastMessagePath), { recursive: true });
  await fs.rm(lastMessagePath, { force: true });

  return new Promise((resolve, reject) => {
    const startedAt = Date.now();
    const child = spawn(CODEX_BIN, args, {
      cwd: workdir,
      env: process.env,
      stdio: ["pipe", "pipe", "pipe"],
      shell: process.platform === "win32",
      windowsHide: true,
    });

    let stdout = "";
    let stderr = "";
    let finished = false;
    let stdoutChunks = 0;
    let stderrChunks = 0;
    let stdoutBytes = 0;
    let stderrBytes = 0;

    let heartbeat: ReturnType<typeof setInterval> | null = setInterval(() => {
      if (finished) return;
      const elapsed = formatDurationMs(Date.now() - startedAt);
      logStep(
        `Analiza w toku (${elapsed}). stdout=${formatBytes(stdoutBytes)} (${stdoutChunks} chunk), stderr=${formatBytes(stderrBytes)} (${stderrChunks} chunk).`,
      );
    }, HEARTBEAT_MS);

    const clearHeartbeat = (): void => {
      if (!heartbeat) return;
      clearInterval(heartbeat);
      heartbeat = null;
    };

    const rejectOnce = (error: Error): void => {
      if (finished) return;
      finished = true;
      clearHeartbeat();
      reject(error);
    };

    child.stdout.on("data", chunk => {
      const value = chunk.toString();
      stdout += value;
      stdoutChunks += 1;
      stdoutBytes += byteLength(value);
      logCli("stdout", value);
    });

    child.stderr.on("data", chunk => {
      const value = chunk.toString();
      stderr += value;
      stderrChunks += 1;
      stderrBytes += byteLength(value);
      logCli("stderr", value);
    });

    child.on("error", error => {
      const err = error as NodeJS.ErrnoException;
      if (err.code === "ENOENT") {
        rejectOnce(
          new Error(
            "Nie znaleziono komendy `codex`. Upewnij sie, ze Codex CLI jest zainstalowany i dostepny w PATH.",
          ),
        );
        return;
      }
      rejectOnce(new Error(`Blad uruchamiania procesu Codex CLI: ${error.message}`));
    });

    child.on("close", code => {
      void (async () => {
        if (finished) return;
        clearHeartbeat();

        const exitCode = code ?? -1;
        const elapsed = formatDurationMs(Date.now() - startedAt);
        logStep(
          `Proces Codex zakonczony (code=${exitCode}, czas=${elapsed}, stdout=${formatBytes(stdoutBytes)}, stderr=${formatBytes(stderrBytes)}).`,
        );

        if (exitCode !== 0) {
          rejectOnce(new Error(`Codex CLI zakonczyl sie kodem ${exitCode}.\nSTDERR:\n${stderr || "(empty)"}`));
          return;
        }

        const lastMessage = (await readTextFile(lastMessagePath, "last message")).trim();
        if (!lastMessage) {
          rejectOnce(new Error("Codex CLI zwrocil pusty wynik."));
          return;
        }

        finished = true;
        resolve({ stdout, stderr, exitCode, command, lastMessage });
      })().catch(error => {
        const message = error instanceof Error ? error.message : "unknown error";
        rejectOnce(new Error(`Blad przetwarzania wyniku Codexa: ${message}`));
      });
    });

    child.stdin.on("error", error => {
      rejectOnce(new Error(`Blad stdin dla Codex CLI: ${error.message}`));
    });

    child.stdin.write(finalPrompt);
    child.stdin.end();
  });
}

function buildChunks(pages: unknown[], maxChunkBytes: number, maxPagesPerChunk: number): ChunkBundle {
  if (!pages.length) {
    return { plan: [], chunks: [] };
  }

  const chunks: unknown[][] = [];
  const plan: ChunkPlanItem[] = [];

  let currentChunk: unknown[] = [];
  let currentBytes = 0;
  let startPageIndex = 0;

  const flush = (): void => {
    if (!currentChunk.length) return;
    const index = chunks.length + 1;
    chunks.push(currentChunk);
    plan.push({
      index,
      startPage: startPageIndex + 1,
      endPage: startPageIndex + currentChunk.length,
      pagesCount: currentChunk.length,
      bytes: currentBytes,
    });
    startPageIndex += currentChunk.length;
    currentChunk = [];
    currentBytes = 0;
  };

  for (const page of pages) {
    const pageBytes = estimateBytes(page);

    const willOverflowBytes = currentBytes + pageBytes > maxChunkBytes;
    const willOverflowCount = currentChunk.length >= maxPagesPerChunk;

    if (currentChunk.length > 0 && (willOverflowBytes || willOverflowCount)) {
      flush();
    }

    currentChunk.push(page);
    currentBytes += pageBytes;

    if (currentChunk.length === 1 && pageBytes > maxChunkBytes) {
      flush();
    }
  }

  flush();
  return { plan, chunks };
}

function stripPages(input: StageInput): Record<string, unknown> {
  const clone: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(input)) {
    if (key === "pages") continue;
    clone[key] = value;
  }
  return clone;
}

function buildChunkPrompt(basePrompt: string, chunkInputJson: string, item: ChunkPlanItem, totalChunks: number): string {
  return `${basePrompt.trim()}

# CHUNK MODE
To jest analiza czesciowa danych (chunk ${item.index}/${totalChunks}).
Analizuj TYLKO dane z tego chunka.
Zwracaj konkretne URL-e i fakty wynikajace z danych.

Dodatkowe zasady:
1. Nie pisz finalnego pelnego raportu 10-sekcyjnego.
2. Zamiast tego zwroc raport czesciowy w markdown z sekcjami:
- CHUNK SUMMARY
- KEY PAGES IN THIS CHUNK
- CONTENT ISSUES
- UX/STRUCTURE ISSUES
- CTA/CONVERSION ISSUES
- KEEP
- IMPROVE
- GAPS
- STRUCTURE HINTS
3. W sekcji STRUCTURE HINTS podawaj tylko propozycje wynikajace z tego chunka.

# INPUT JSON
\`\`\`json
${chunkInputJson}
\`\`\`
`;
}

function buildMergePrompt(basePrompt: string, mergeJson: string): string {
  return `${basePrompt.trim()}

# MERGE MODE
Ponizej dostajesz raporty czesciowe (chunkowe), ktore lacznie pokrywaja caly dataset.
Twoim celem jest zsyntetyzowac JEDEN finalny raport w docelowym formacie z promptu.

Zasady merge:
1. Scalaj fakty bez duplikatow.
2. Gdy sa sprzecznosci, zaznacz je jawnie.
3. Priorytet: strony i problemy powtarzajace sie w wielu chunkach.
4. Nie dopowiadaj czegos, czego nie ma w raportach chunkowych.

# INPUT JSON
\`\`\`json
${mergeJson}
\`\`\`
`;
}

async function runSingleCodexAnalysis(
  title: string,
  finalPrompt: string,
  cwd: string,
  lastMessagePath: string,
): Promise<CodexRunResult> {
  logStep(`${title}: start (prompt=${formatBytes(byteLength(finalPrompt))}).`);
  const result = await runCodexCli(finalPrompt, cwd, lastMessagePath);
  logStep(`${title}: done (lastMessage=${formatBytes(byteLength(result.lastMessage))}).`);
  return result;
}

async function main(): Promise<void> {
  const cwd = process.cwd();

  const promptPath = path.resolve(cwd, PROMPT_FILE_REL);
  const inputJsonPath = path.resolve(cwd, INPUT_JSON_REL);
  const outputMdPath = path.resolve(cwd, OUTPUT_MD_REL);
  const outputRawPath = path.resolve(cwd, OUTPUT_RAW_REL);
  const chunksDir = path.resolve(cwd, CHUNKS_DIR_REL);
  const lastMessagePath = path.resolve(cwd, LAST_MESSAGE_TMP_REL);
  let completed = false;

  try {
    logStep("Start ETAP 4 (chunked AI analysis). No trimming, full dataset split into chunks.");

    await cleanupTmpFiles(cwd);
    if (!KEEP_ARTIFACTS) {
      await cleanupChunksDir(chunksDir);
    }

    await assertFileExists(promptPath, PROMPT_FILE_REL);
    await assertFileExists(inputJsonPath, INPUT_JSON_REL);

    const promptTemplate = await readTextFile(promptPath, "prompt");
    const rawInputJson = await readTextFile(inputJsonPath, "input json");

    let parsedInput: StageInput;
    try {
      parsedInput = JSON.parse(rawInputJson) as StageInput;
    } catch (error) {
      const message = error instanceof Error ? error.message : "unknown error";
      fail(`Nieprawidlowy JSON w ${inputJsonPath}: ${message}`);
    }

    const pages = getPages(parsedInput);
    if (!pages.length) {
      fail("Brak pages[] w output/03-enriched-site-data.json");
    }

    logStep(
      `Wejscie: pages=${pages.length}, size=${formatBytes(byteLength(rawInputJson))}, maxChunk=${formatBytes(MAX_CHUNK_BYTES)}, maxPagesPerChunk=${MAX_PAGES_PER_CHUNK}`,
    );

    const chunked = buildChunks(pages, MAX_CHUNK_BYTES, MAX_PAGES_PER_CHUNK);
    logStep(`Podzial na chunki: ${chunked.chunks.length}`);

    await fs.mkdir(chunksDir, { recursive: true });

    const sourceMeta = stripPages(parsedInput);
    const chunkResults: Array<{
      chunk: ChunkPlanItem;
      file: string;
      analysis: string;
      rawLogFile: string;
    }> = [];

    for (let i = 0; i < chunked.chunks.length; i += 1) {
      const chunkPages = chunked.chunks[i];
      const planItem = chunked.plan[i];
      if (!planItem) continue;

      const chunkInput = {
        ...sourceMeta,
        chunkInfo: {
          index: planItem.index,
          totalChunks: chunked.chunks.length,
          startPage: planItem.startPage,
          endPage: planItem.endPage,
          pagesCount: planItem.pagesCount,
          estimatedBytes: planItem.bytes,
        },
        pages: chunkPages,
      };

      const chunkInputJson = toJsonPretty(chunkInput);
      const finalPrompt = buildChunkPrompt(promptTemplate, chunkInputJson, planItem, chunked.chunks.length);

      const chunkFile = path.resolve(chunksDir, `chunk-${String(planItem.index).padStart(2, "0")}-analysis.md`);
      const chunkRawFile = path.resolve(chunksDir, `chunk-${String(planItem.index).padStart(2, "0")}-raw.txt`);

      if (DRY_RUN) {
        await writeTextFile(chunkFile, `DRY RUN\n\nPrompt bytes: ${byteLength(finalPrompt)}\n`);
        await writeTextFile(chunkRawFile, "DRY RUN");
        chunkResults.push({ chunk: planItem, file: chunkFile, analysis: "DRY RUN", rawLogFile: chunkRawFile });
        continue;
      }

      const result = await runSingleCodexAnalysis(
        `chunk ${planItem.index}/${chunked.chunks.length}`,
        finalPrompt,
        cwd,
        lastMessagePath,
      );

      await writeTextFile(chunkFile, result.lastMessage);
      await writeTextFile(chunkRawFile, buildRawLog(`chunk-${planItem.index}`, result));

      chunkResults.push({
        chunk: planItem,
        file: chunkFile,
        analysis: result.lastMessage,
        rawLogFile: chunkRawFile,
      });
    }

    const mergeInput = {
      sourceMeta,
      pagesTotal: pages.length,
      chunkCount: chunked.chunks.length,
      chunks: chunkResults.map(item => ({
        index: item.chunk.index,
        startPage: item.chunk.startPage,
        endPage: item.chunk.endPage,
        pagesCount: item.chunk.pagesCount,
        analysis: item.analysis,
      })),
    };

    const mergeInputJson = toJsonPretty(mergeInput);
    const mergePrompt = buildMergePrompt(promptTemplate, mergeInputJson);

    if (DRY_RUN) {
      await writeTextFile(path.resolve(chunksDir, "chunk-plan.json"), toJsonPretty(chunked.plan));
      await writeTextFile(outputMdPath, "DRY RUN - stage4 merge skipped");
      await writeTextFile(outputRawPath, "DRY RUN");
      logStep("DRY RUN zakonczony.");
      completed = true;
      return;
    }

    const finalResult = await runSingleCodexAnalysis("merge", mergePrompt, cwd, lastMessagePath);

    await writeTextFile(outputMdPath, finalResult.lastMessage);

    const globalRawLog = [
      `generatedAt: ${new Date().toISOString()}`,
      `chunkCount: ${chunked.chunks.length}`,
      `inputBytes: ${byteLength(rawInputJson)}`,
      `mergePromptBytes: ${byteLength(mergePrompt)}`,
      "",
      "===== MERGE RAW =====",
      buildRawLog("merge", finalResult),
      "",
      "===== CHUNK FILES =====",
      ...chunkResults.map(item => `- ${item.file}`),
    ].join("\n");

    await writeTextFile(outputRawPath, globalRawLog);
    await writeTextFile(path.resolve(chunksDir, "chunk-plan.json"), toJsonPretty(chunked.plan));

    logStep("ETAP 4 zakonczony sukcesem.");
    logStep(`- output: ${outputMdPath}`);
    logStep(`- raw: ${outputRawPath}`);
    logStep(`- chunksDir: ${chunksDir}`);
    completed = true;
  } finally {
    await cleanupTmpFiles(cwd);
    if (completed && !KEEP_ARTIFACTS) {
      await cleanupChunksDir(chunksDir);
      logStep("Wyczyszczono artefakty robocze (tmp + chunks).");
    }
  }
}

main().catch(error => {
  const message = error instanceof Error ? error.message : "unknown error";
  console.error(`[stage4] BLAD: ${message}`);
  process.exit(1);
});
