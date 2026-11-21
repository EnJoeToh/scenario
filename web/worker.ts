import { compile } from './compile.ts';
import type { CompileRequest, WorkerResponse } from './compile.ts';

self.onmessage = (event: MessageEvent<CompileRequest>) => {
  let response: WorkerResponse;
  try { response = { result: compile(event.data) }; }
  catch (error) { response = { error: error instanceof Error ? error.message : String(error) }; }
  self.postMessage(response);
};
