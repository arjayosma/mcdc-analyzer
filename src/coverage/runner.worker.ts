// Runs the user's tests away from the page, so a slow or endless loop cannot
// freeze the app; the page terminates this worker when it times out.
import { executeTests, type RunRequest } from './runtime';
import { sucraseTransform } from './transform';

const scope = self as unknown as {
  onmessage: ((event: MessageEvent<RunRequest>) => void) | null;
  postMessage(message: unknown): void;
};

scope.onmessage = (event) => {
  void executeTests(event.data, sucraseTransform).then((outcome) => scope.postMessage(outcome));
};
