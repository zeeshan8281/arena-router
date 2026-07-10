// Single image, two roles. EigenCompute runs the image's CMD, so the role is
// selected by env (ROLE_PUBLIC), not a per-app CMD override.
export {}; // make this a module so top-level await is allowed

switch (process.env.ROLE_PUBLIC ?? "conductor") {
  case "worker":
    await import("./worker/index.js");
    break;
  case "grader":
    await import("./grader/index.js");
    break;
  default:
    await import("./index.js");
}
