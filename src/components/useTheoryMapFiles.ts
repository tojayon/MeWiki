import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
import type { ResearchNotebookState } from "../domain/researchNotebook.ts";
import {
  ensureTheoryMaps,
  type TheoryMapDocument,
} from "../domain/researchTheoryMap.ts";
import {
  importTheoryMapFile,
  parseTheoryMapFile,
  rememberTheoryDirectory,
  serializeTheoryMapFile,
  TheoryMapDirectoryWriter,
  type TheoryDirectory,
} from "../state/theoryMapFiles.ts";

type PickerWindow = Window & {
  showDirectoryPicker?: (options: {
    mode: "readwrite";
    id: string;
  }) => Promise<TheoryDirectory>;
};

export default function useTheoryMapFiles(
  state: ResearchNotebookState,
  onChange: (state: ResearchNotebookState) => void,
) {
  const latest = useRef({ state, onChange });
  useLayoutEffect(() => {
    latest.current = { state, onChange };
  }, [state, onChange]);
  const writer = useRef<TheoryMapDirectoryWriter | null>(null);
  const handle = useRef<TheoryDirectory | undefined>(undefined);
  const generation = useRef(0);
  const [directoryName, setDirectoryName] = useState("");
  const [status, setStatus] = useState("浏览器中已保存");
  const [error, setError] = useState("");
  const [revision, setRevision] = useState(0);
  const [available] = useState(
    () => typeof (window as PickerWindow).showDirectoryPicker === "function",
  );

  const connection = useRef(0);
  const connecting = useRef(false);
  const readDirectory = useCallback(
    async (
      directory: TheoryDirectory,
      current: () => boolean = () => true,
      known?: TheoryMapDirectoryWriter,
    ) => {
      const files: string[] = [];
      if (directory.values)
        for await (const entry of directory.values()) {
          if (
            entry.kind !== "file" ||
            !entry.name.endsWith(".theorymap.json") ||
            !entry.getFile
          )
            continue;
          const content = await (await entry.getFile()).text();
          parseTheoryMapFile(content);
          files.push(content);
        }
      if (!current()) return 0;
      let next = ensureTheoryMaps(latest.current.state);
      let count = 0;
      for (const content of files) {
        const document = parseTheoryMapFile(content);
        if (known?.hasSavedFile(document)) continue;
        if (next.theoryMaps!.deletedMapIds.includes(document.id)) continue;
        const existing = next.theoryMaps!.documents.find(
          (item) => item.id === document.id,
        );
        if (
          existing &&
          serializeTheoryMapFile(
            existing,
          ) === serializeTheoryMapFile(document)
        )
          continue;
        next = importTheoryMapFile(next, content);
        count++;
      }
      if (count) {
        latest.current = { ...latest.current, state: next };
        latest.current.onChange(next);
      }
      return count;
    },
    [],
  );

  useEffect(() => {
    let disposed = false;
    const ticket = connection.current;
    const current = () => !disposed && connection.current === ticket;
    void rememberTheoryDirectory()
      .then(async (directory) => {
        if (!current() || !directory) return;
        handle.current = directory;
        setDirectoryName(directory.name);
        if (
          (await directory.queryPermission({ mode: "readwrite" })) !== "granted"
        ) {
          if (!disposed) setStatus("浏览器中已保存 · 目录需重新授权");
          return;
        }
        await readDirectory(directory, current);
        if (!current()) return;
        writer.current = new TheoryMapDirectoryWriter(directory);
        setRevision((value) => value + 1);
      })
      .catch((reason: unknown) => {
        if (current()) {
          setStatus("浏览器中已保存 · 目录尚未同步");
          setError(
            reason instanceof Error
              ? reason.message
              : "无法恢复保存目录，请重新连接。",
          );
        }
      });
    return () => {
      disposed = true;
    };
  }, [readDirectory]);

  const documents = state.theoryMaps?.documents;
  const content = JSON.stringify(documents);
  useEffect(() => {
    if (!writer.current || !documents) return;
    const destination = writer.current;
    const ticket = ++generation.current;
    setStatus("正在写入保存目录…");
    const timer = window.setTimeout(() => {
      if (writer.current !== destination) return;
      void destination
        .save(documents, state.theoryMaps?.deletedMapIds)
        .then(() => {
          if (generation.current === ticket) {
            setStatus("已写入保存目录");
            setError("");
          }
        })
        .catch((reason: unknown) => {
          if (generation.current === ticket) {
            setStatus("浏览器中已保存 · 目录写入失败");
            setError(
              reason instanceof Error
                ? reason.message
                : "目录写入失败，请重试。",
            );
          }
        });
    }, 350);
    return () => window.clearTimeout(timer);
    // Serialize only changed document snapshots, not every notebook selection.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [content, revision]);

  const connect = useCallback(
    async (chooseNew = false) => {
      if (connecting.current) return;
      connecting.current = true;
      setError("");
      let previous: TheoryMapDirectoryWriter | null = null;
      let suspended = false;
      try {
        const picker = (window as PickerWindow).showDirectoryPicker;
        if (!picker) {
          setError("此浏览器不支持目录保存，请使用导入、导出地图文件。");
          return;
        }
        const directory =
          !chooseNew && handle.current
            ? handle.current
            : await picker({ mode: "readwrite", id: "webbench-theory-maps" });
        if (
          (await directory.requestPermission({ mode: "readwrite" })) !==
          "granted"
        )
          throw new Error("尚未授予目录写入权限，地图仍保存在浏览器中。");
        const ticket = ++connection.current;
        previous = writer.current;
        writer.current = null;
        suspended = true;
        generation.current++;
        setStatus("正在连接保存目录…");
        await previous?.drain();
        const sameDirectory =
          previous &&
          (previous.directory === directory ||
            (await directory.isSameEntry?.(previous.directory)));
        // Existing files are read before enabling writes. Same-ID conflicts become independent copies.
        await readDirectory(
          directory,
          () => connection.current === ticket,
          sameDirectory ? previous! : undefined,
        );
        if (connection.current !== ticket) return;
        handle.current = directory;
        writer.current = sameDirectory
          ? previous
          : new TheoryMapDirectoryWriter(directory);
        setDirectoryName(directory.name);
        setRevision((value) => value + 1);
        try {
          await rememberTheoryDirectory(directory);
        } catch {
          setError("目录已连接，但无法记住授权；下次刷新需重新选择。");
        }
      } catch (reason) {
        if (suspended) {
          writer.current = previous;
          setRevision((value) => value + 1);
        }
        if (reason instanceof DOMException && reason.name === "AbortError")
          return;
        setError(
          reason instanceof Error ? reason.message : "无法打开保存目录。",
        );
      } finally {
        connecting.current = false;
      }
    },
    [readDirectory],
  );

  const importDirectory = async () => {
    if (!handle.current) return;
    try {
      const count = await readDirectory(handle.current);
      setError("");
      if (!count) setStatus("保存目录没有新的地图版本");
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "读取目录失败。");
    }
  };
  const retry = () => setRevision((value) => value + 1);
  const exportDocument = (doc: TheoryMapDocument) => {
    const url = URL.createObjectURL(
      new Blob([serializeTheoryMapFile(doc)], { type: "application/json" }),
    );
    const link = document.createElement("a");
    link.href = url;
    link.download =
      Array.from(doc.title, (letter) =>
        letter.charCodeAt(0) < 32 || /[<>:"/\\|?*]/.test(letter) ? "_" : letter,
      )
        .join("")
        .slice(0, 80) + ".theorymap.json";
    link.click();
    window.setTimeout(() => URL.revokeObjectURL(url), 1000);
  };
  return {
    status,
    error,
    setError,
    directoryName,
    available,
    connect,
    retry,
    importDirectory,
    exportDocument,
  };
}
