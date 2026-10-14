import { prepareSave } from './save-preparation.js';

self.onmessage = ({ data: { ticket, project } }) => {
  try {
    const result = prepareSave(project);
    self.postMessage({ ticket, result }, [result.data.buffer]);
  } catch (error) {
    self.postMessage({ ticket, error: error.message });
  }
};
