import { parseDatasetFile, type DatasetWorkerInput, type DatasetWorkerResult } from "../domain/researchDatasetImport.ts";

const scope = globalThis as unknown as { onmessage: (event: MessageEvent<DatasetWorkerInput>) => void; postMessage: (value: DatasetWorkerResult) => void };
scope.onmessage = event => {
  void parseDatasetFile(event.data.buffer, event.data.name)
    .then(result => scope.postMessage({ result }))
    .catch((cause: unknown) => scope.postMessage({ error: cause instanceof Error ? cause.message : "数据文件无法读取，请检查格式。" }));
};
