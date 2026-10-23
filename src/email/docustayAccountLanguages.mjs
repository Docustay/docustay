// The account-deletion emails (scheduled, kept, reminder, done) in English (the 13 other languages were removed in Docustay v1). Pure data. Placeholders: {name} {date}. Same rules as docustayBillingLanguages.mjs: every language carries every key
// (test/docustay_account_emails.test.mjs); English is the fallback for an unknown language only.
export const ACCOUNT_KEYS = ["accSub", "accI", "accWhen", "accSoon", "keptAcc", "accNotYou", "btnKeepAcc", "wsSub", "wsI", "wsWhen", "keptWs", "wsNotExpected", "btnKeepWs",
  "keptAccSub", "keptAccBody", "keptWsSub", "keptWsBody", "wsPlanEnded", "wsPlanEndedNoDays", "wsPlanLifetime", "remAccSub", "remWsSub", "remAccI", "remWsI", "remBody", "btnKeep", "doneSub", "doneI"];

export const ACCOUNT = {
  en: {
    accSub: "Your Docustay account is scheduled for deletion", accI: "You asked us to delete your Docustay account.",
    accWhen: "It will be deleted on {date}. Until then you can change your mind: sign in and choose “Keep my account” (Settings → Workspace → Data).", accSoon: "It will be deleted within the hour.",
    keptAcc: "What stays: any document you signed stays as the signed record, with your name as you signed it, because it is evidence of an agreement with other people. Documents you were asked to sign but had not signed are removed.",
    accNotYou: "If this wasn't you, sign in now and choose “Keep my account”, then change your password.", btnKeepAcc: "Keep my account",
    wsSub: "“{name}” is scheduled for deletion", wsI: "The Docustay workspace “{name}” was scheduled for deletion.",
    wsWhen: "It will be deleted on {date}. Until then everything keeps working and any owner can stop it (Settings → Workspace → Data → Keep this workspace).",
    keptWs: "Everything in the workspace goes: its documents (including signed copies and certificates), templates, people, settings and sign-in sessions. Download everything first (Settings → Workspace → Data).",
    wsNotExpected: "If this wasn't expected, sign in now and keep the workspace.", btnKeepWs: "Keep this workspace",
    keptAccSub: "Your Docustay account was kept", keptAccBody: "Your account will not be deleted. Nothing was removed.", keptWsSub: "Your Docustay workspace was kept", keptWsBody: "The workspace will not be deleted. Nothing was removed. If it had a paid plan, that plan ended when the deletion was scheduled, so the workspace is now on Free. You can choose a plan again in Billing.",
    wsPlanEnded: "Your {plan} plan was cancelled today. {days} of paid time were left, and they are lost: they cannot be recovered and Docustay gives no refunds.", wsPlanEndedNoDays: "Your {plan} plan was cancelled today. Docustay gives no refunds.", wsPlanLifetime: "Your Lifetime plan ended today. It was a one-time purchase, it cannot be recovered and Docustay gives no refunds.",
    remAccSub: "Reminder: your account will be deleted on {date}", remWsSub: "Reminder: your workspace will be deleted on {date}",
    remAccI: "This is a reminder that your account will be deleted on {date}.", remWsI: "This is a reminder that your workspace will be deleted on {date}.",
    remBody: "To keep it, sign in and choose “Keep” (Settings → Workspace → Data).", btnKeep: "Keep it",
    doneSub: "Your Docustay account was deleted", doneI: "Your Docustay account has been deleted. Your details were erased and you were signed out everywhere.",
  },
};
