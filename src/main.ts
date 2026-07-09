// Single image, two roles. EigenCompute runs the image's CMD, so the role is
// selected by env (ROLE_PUBLIC), not a per-app CMD override.
export {}; // make this a module so top-level await is allowed

if ((process.env.ROLE_PUBLIC ?? "conductor") === "worker") {
  await import("./worker/index.js");
} else {
  await import("./index.js");
}
