// R13-D291: a turn makes several model calls. When the work (a draft, an edit) is already done and only the call for the closing words fails, the message says the result is ready,
// not "could not be reached; try again", which read as if the draft had failed. A turn that produced nothing keeps the provider's own words.
export const afterWork = (m, message) => (m?.proposals?.length ? "Your result is ready below. The assistant's closing note did not come through; nothing else is needed." : message);
