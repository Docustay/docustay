// A name the gates import whose React module is not built yet (scripts/build-react-gate-entry.mjs).
// ★ It THROWS when rendered or called — a gate mounting an unbuilt screen fails with the file it needs,
//   rather than passing against an empty component (the vacuous-guard failure this project has shipped).
export function pending(name, file) {
  const fail = () => { throw new Error(`${name} is not built yet — webreact/src/${file} (React rebuild R4+)`); };
  const stub = function PendingComponent() { return fail(); };
  stub.pending = true;
  stub.displayName = `Pending(${name})`;
  return stub;
}
