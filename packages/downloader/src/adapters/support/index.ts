// Shared adapter infrastructure seams (kept behind interfaces so network adapters stay testable).
export { fetchHttpClient } from './http.js';
export type { HttpClient, HttpRequest, HttpResponse } from './http.js';
