// The two sign-in emails a person can ask for before they are signed in - the sign-in code and the password reset - in the 13 languages. Pure data. {code}, {minutes} and {link} are filled in at send time; "Docustay" is the product name and is never translated.
// Read once by the same reviewer pass as the signing page (the machine does not clear these); the placeholder and brand checks are in test/p31_auth_email_languages.test.mjs.
export const AUTH_EMAIL = {
  es: {
    code: { subject: "Su código de acceso a Docustay", text: "Su código de acceso es {code}. Caduca en {minutes} minutos.\n\nSi no ha solicitado este código, puede ignorar este correo." },
    verify: { subject: "Su código de verificación de Docustay", text: "Su código de verificación es {code}. Caduca en {minutes} minutos.\n\nSi no ha solicitado este código, puede ignorar este correo." },
    reset: { subject: "Restablezca su contraseña de Docustay", text: "Alguien ha solicitado restablecer la contraseña de esta dirección de correo. Para elegir una nueva, abra este enlace:\n\n{link}\n\nEl enlace funciona una sola vez y caduca pronto. Si no lo ha solicitado, puede ignorar este correo: su contraseña no ha cambiado." },
  },
  fr: {
    code: { subject: "Votre code de connexion Docustay", text: "Votre code de connexion est {code}. Il expire dans {minutes} minutes.\n\nSi vous n'avez pas demandé ce code, vous pouvez ignorer cet e-mail." },
    verify: { subject: "Votre code de vérification Docustay", text: "Votre code de vérification est {code}. Il expire dans {minutes} minutes.\n\nSi vous n'avez pas demandé ce code, vous pouvez ignorer cet e-mail." },
    reset: { subject: "Réinitialisez votre mot de passe Docustay", text: "Quelqu'un a demandé la réinitialisation du mot de passe associé à cette adresse e-mail. Pour en choisir un nouveau, ouvrez ce lien :\n\n{link}\n\nLe lien ne fonctionne qu'une fois et expire bientôt. Si vous n'êtes pas à l'origine de cette demande, ignorez cet e-mail : votre mot de passe n'a pas changé." },
  },
  de: {
    code: { subject: "Ihr Docustay-Anmeldecode", text: "Ihr Anmeldecode lautet {code}. Er läuft in {minutes} Minuten ab.\n\nWenn Sie diesen Code nicht angefordert haben, können Sie diese E-Mail ignorieren." },
    verify: { subject: "Ihr Docustay-Bestätigungscode", text: "Ihr Bestätigungscode lautet {code}. Er läuft in {minutes} Minuten ab.\n\nWenn Sie diesen Code nicht angefordert haben, können Sie diese E-Mail ignorieren." },
    reset: { subject: "Docustay-Passwort zurücksetzen", text: "Jemand hat darum gebeten, das Passwort für diese E-Mail-Adresse zurückzusetzen. Um ein neues Passwort zu wählen, öffnen Sie diesen Link:\n\n{link}\n\nDer Link funktioniert nur einmal und läuft bald ab. Wenn Sie das nicht angefordert haben, ignorieren Sie diese E-Mail – Ihr Passwort wurde nicht geändert." },
  },
  pt: {
    code: { subject: "Seu código de acesso do Docustay", text: "Seu código de acesso é {code}. Ele expira em {minutes} minutos.\n\nSe você não solicitou este código, pode ignorar este e-mail." },
    verify: { subject: "Seu código de verificação do Docustay", text: "Seu código de verificação é {code}. Ele expira em {minutes} minutos.\n\nSe você não solicitou este código, pode ignorar este e-mail." },
    reset: { subject: "Redefina sua senha do Docustay", text: "Alguém pediu para redefinir a senha deste endereço de e-mail. Para escolher uma nova, abra este link:\n\n{link}\n\nO link funciona uma única vez e expira em breve. Se você não fez esse pedido, ignore este e-mail: sua senha não foi alterada." },
  },
  it: {
    code: { subject: "Il tuo codice di accesso a Docustay", text: "Il tuo codice di accesso è {code}. Scade tra {minutes} minuti.\n\nSe non hai richiesto questo codice, puoi ignorare questa e-mail." },
    verify: { subject: "Il tuo codice di verifica Docustay", text: "Il tuo codice di verifica è {code}. Scade tra {minutes} minuti.\n\nSe non hai richiesto questo codice, puoi ignorare questa e-mail." },
    reset: { subject: "Reimposta la password di Docustay", text: "Qualcuno ha chiesto di reimpostare la password di questo indirizzo e-mail. Per sceglierne una nuova, apri questo link:\n\n{link}\n\nIl link funziona una sola volta e scade presto. Se non l'hai chiesto tu, ignora questa e-mail: la tua password non è cambiata." },
  },
  nl: {
    code: { subject: "Uw Docustay-inlogcode", text: "Uw inlogcode is {code}. De code verloopt over {minutes} minuten.\n\nAls u deze code niet hebt aangevraagd, kunt u deze e-mail negeren." },
    verify: { subject: "Uw Docustay-verificatiecode", text: "Uw verificatiecode is {code}. De code verloopt over {minutes} minuten.\n\nAls u deze code niet hebt aangevraagd, kunt u deze e-mail negeren." },
    reset: { subject: "Stel uw Docustay-wachtwoord opnieuw in", text: "Iemand heeft gevraagd het wachtwoord voor dit e-mailadres opnieuw in te stellen. Open deze link om een nieuw wachtwoord te kiezen:\n\n{link}\n\nDe link werkt maar één keer en verloopt snel. Als u dit niet hebt aangevraagd, kunt u deze e-mail negeren: uw wachtwoord is niet gewijzigd." },
  },
  pl: {
    code: { subject: "Twój kod logowania do Docustay", text: "Twój kod logowania to {code}. Wygasa za {minutes} min.\n\nJeśli nie prosisz o ten kod, zignoruj tę wiadomość." },
    verify: { subject: "Twój kod weryfikacyjny Docustay", text: "Twój kod weryfikacyjny to {code}. Wygasa za {minutes} min.\n\nJeśli nie prosisz o ten kod, zignoruj tę wiadomość." },
    reset: { subject: "Zresetuj hasło do Docustay", text: "Ktoś poprosił o zresetowanie hasła dla tego adresu e-mail. Aby wybrać nowe, otwórz ten link:\n\n{link}\n\nLink działa tylko raz i wkrótce wygaśnie. Jeśli to nie ty o to prosisz, zignoruj tę wiadomość — hasło nie zostało zmienione." },
  },
  tr: {
    code: { subject: "Docustay giriş kodunuz", text: "Giriş kodunuz {code}. {minutes} dakika sonra geçerliliğini yitirir.\n\nBu kodu siz istemediyseniz bu e-postayı yok sayabilirsiniz." },
    verify: { subject: "Docustay doğrulama kodunuz", text: "Doğrulama kodunuz {code}. {minutes} dakika sonra geçerliliğini yitirir.\n\nBu kodu siz istemediyseniz bu e-postayı yok sayabilirsiniz." },
    reset: { subject: "Docustay parolanızı sıfırlayın", text: "Biri bu e-posta adresinin parolasını sıfırlamak istedi. Yeni bir parola seçmek için şu bağlantıyı açın:\n\n{link}\n\nBağlantı yalnızca bir kez çalışır ve kısa süre sonra geçerliliğini yitirir. Bunu siz istemediyseniz bu e-postayı yok sayabilirsiniz; parolanız değişmedi." },
  },
  ru: {
    code: { subject: "Ваш код для входа в Docustay", text: "Ваш код для входа: {code}. Он действует {minutes} мин.\n\nЕсли вы не запрашивали этот код, просто проигнорируйте это письмо." },
    verify: { subject: "Ваш код подтверждения Docustay", text: "Ваш код подтверждения: {code}. Он действует {minutes} мин.\n\nЕсли вы не запрашивали этот код, просто проигнорируйте это письмо." },
    reset: { subject: "Сброс пароля Docustay", text: "Кто-то запросил сброс пароля для этого адреса электронной почты. Чтобы выбрать новый пароль, откройте эту ссылку:\n\n{link}\n\nСсылка работает один раз и скоро перестанет действовать. Если вы этого не запрашивали, проигнорируйте письмо: ваш пароль не изменился." },
  },
  ar: {
    code: { subject: "رمز تسجيل الدخول إلى Docustay", text: "رمز تسجيل الدخول الخاص بك هو {code}. تنتهي صلاحيته خلال {minutes} دقيقة.\n\nإذا لم تطلب هذا الرمز، يمكنك تجاهل هذه الرسالة." },
    verify: { subject: "رمز التحقق من Docustay", text: "رمز التحقق الخاص بك هو {code}. تنتهي صلاحيته خلال {minutes} دقيقة.\n\nإذا لم تطلب هذا الرمز، يمكنك تجاهل هذه الرسالة." },
    reset: { subject: "إعادة تعيين كلمة مرور Docustay", text: "طلب شخص ما إعادة تعيين كلمة المرور لعنوان البريد الإلكتروني هذا. لاختيار كلمة مرور جديدة، افتح هذا الرابط:\n\n{link}\n\nيعمل الرابط مرة واحدة فقط وتنتهي صلاحيته قريباً. إذا لم تطلب ذلك، يمكنك تجاهل هذه الرسالة؛ لم تتغير كلمة مرورك." },
  },
  ja: {
    code: { subject: "Docustayのログインコード", text: "ログインコードは {code} です。有効期限は {minutes} 分です。\n\nこのコードをリクエストしていない場合は、このメールを無視してください。" },
    verify: { subject: "Docustayの確認コード", text: "確認コードは {code} です。有効期限は {minutes} 分です。\n\nこのコードをリクエストしていない場合は、このメールを無視してください。" },
    reset: { subject: "Docustayのパスワードをリセット", text: "このメールアドレスのパスワードをリセットするリクエストがありました。新しいパスワードを設定するには、次のリンクを開いてください。\n\n{link}\n\nリンクは一度だけ使え、まもなく無効になります。心当たりがない場合は、このメールを無視してください。パスワードは変更されていません。" },
  },
  zh: {
    code: { subject: "您的 Docustay 登录验证码", text: "您的登录验证码是 {code}，{minutes} 分钟后失效。\n\n如果您没有请求此验证码，请忽略这封邮件。" },
    verify: { subject: "您的 Docustay 验证码", text: "您的验证码是 {code}，{minutes} 分钟后失效。\n\n如果您没有请求此验证码，请忽略这封邮件。" },
    reset: { subject: "重置您的 Docustay 密码", text: "有人请求重置此邮箱地址的密码。要设置新密码，请打开此链接：\n\n{link}\n\n该链接只能使用一次，并将很快失效。如果这不是您的操作，请忽略这封邮件，您的密码没有更改。" },
  },
  ko: {
    code: { subject: "Docustay 로그인 코드", text: "로그인 코드는 {code}입니다. {minutes}분 후에 만료됩니다.\n\n이 코드를 요청하지 않으셨다면 이 이메일을 무시하셔도 됩니다." },
    verify: { subject: "Docustay 인증 코드", text: "인증 코드는 {code}입니다. {minutes}분 후에 만료됩니다.\n\n이 코드를 요청하지 않으셨다면 이 이메일을 무시하세요." },
    reset: { subject: "Docustay 비밀번호 재설정", text: "누군가 이 이메일 주소의 비밀번호 재설정을 요청했습니다. 새 비밀번호를 정하려면 다음 링크를 여세요.\n\n{link}\n\n링크는 한 번만 사용할 수 있으며 곧 만료됩니다. 요청하신 적이 없다면 이 이메일을 무시하세요. 비밀번호는 변경되지 않았습니다." },
  },
};
/** The words for one of the two emails in a language, or null (English is used). @param {"code"|"verify"|"reset"} kind */
export function authEmailWords(lang, kind, vars) {
  const w = AUTH_EMAIL[lang]?.[kind]; if (!w) return null;
  const fill = (s) => s.replace(/\{(code|minutes|link)\}/g, (_, k) => String(vars[k] ?? ""));
  return { subject: fill(w.subject), text: fill(w.text) };
}
