// The four welcome-series emails (welcome, day 1, day 3, day 6) and their footer, in English and the 13 other languages. Pure data. {link} is the one button-link of each mail; {unsub} the one-click unsubscribe link;
// {address} the sender's postal address. Each mail has one idea and one link. Read once by the same reviewer pass as the other emails; the placeholder and brand checks are in test/launch_welcome_series.test.mjs.
export const WELCOME = {
  en: {
    steps: [
      { subject: "Welcome to Docustay", body: "Your workspace is ready. Upload a PDF, place the signature fields, and send it: the signer gets a link, and you get a sealed copy with a certificate.", cta: "Send your first document" },
      { subject: "Send your first document", body: "It takes about two minutes: upload a PDF, place the fields, say who signs, and send. Nothing is charged and the signer needs no account.", cta: "Send a document" },
      { subject: "Save a document you send often", body: "If you send the same document again and again, save it as a template. Next time it is one click: the fields and the wording are already there.", cta: "Open templates" },
      { subject: "Invite a teammate", body: "A teammate can send and track documents with you, so nothing waits on one person. Add them by email; they sign in with a code.", cta: "Invite a teammate" },
    ],
    foot: { why: "You get this because you created a Docustay account. It is one of four short emails in your first week.", unsub: "Stop these emails", settings: "Or turn them off in Settings, Account." },
  },
  es: {
    steps: [
      { subject: "Le damos la bienvenida a Docustay", body: "Su espacio de trabajo está listo. Suba un PDF, coloque los campos de firma y envíelo: quien firma recibe un enlace y usted recibe una copia sellada con certificado.", cta: "Enviar su primer documento" },
      { subject: "Envíe su primer documento", body: "Lleva unos dos minutos: suba un PDF, coloque los campos, indique quién firma y envíe. No se cobra nada y quien firma no necesita cuenta.", cta: "Enviar un documento" },
      { subject: "Guarde el documento que envía a menudo", body: "Si envía el mismo documento una y otra vez, guárdelo como plantilla. La próxima vez bastará un clic: los campos y el texto ya estarán ahí.", cta: "Abrir plantillas" },
      { subject: "Invite a un compañero", body: "Un compañero puede enviar y seguir documentos con usted, así nada depende de una sola persona. Añádalo por correo; entra con un código.", cta: "Invitar a un compañero" },
    ],
    foot: { why: "Recibe este mensaje porque creó una cuenta de Docustay. Es uno de cuatro correos breves de su primera semana.", unsub: "Dejar de recibir estos correos", settings: "O desactívelos en Ajustes, Cuenta." },
  },
  fr: {
    steps: [
      { subject: "Bienvenue sur Docustay", body: "Votre espace de travail est prêt. Importez un PDF, placez les champs de signature et envoyez-le : le signataire reçoit un lien et vous recevez une copie scellée avec certificat.", cta: "Envoyer votre premier document" },
      { subject: "Envoyez votre premier document", body: "Il faut environ deux minutes : importez un PDF, placez les champs, indiquez qui signe et envoyez. Rien n'est facturé et le signataire n'a pas besoin de compte.", cta: "Envoyer un document" },
      { subject: "Enregistrez le document que vous envoyez souvent", body: "Si vous envoyez toujours le même document, enregistrez-le comme modèle. La prochaine fois, un clic suffit : les champs et le texte sont déjà là.", cta: "Ouvrir les modèles" },
      { subject: "Invitez un collègue", body: "Un collègue peut envoyer et suivre des documents avec vous, pour que rien ne dépende d'une seule personne. Ajoutez-le par e-mail ; il se connecte avec un code.", cta: "Inviter un collègue" },
    ],
    foot: { why: "Vous recevez ce message parce que vous avez créé un compte Docustay. C'est l'un des quatre courts e-mails de votre première semaine.", unsub: "Ne plus recevoir ces e-mails", settings: "Ou désactivez-les dans Paramètres, Compte." },
  },
  de: {
    steps: [
      { subject: "Willkommen bei Docustay", body: "Ihr Arbeitsbereich ist bereit. Laden Sie ein PDF hoch, setzen Sie die Signaturfelder und senden Sie es: Die unterzeichnende Person erhält einen Link, Sie erhalten eine versiegelte Kopie mit Zertifikat.", cta: "Erstes Dokument senden" },
      { subject: "Senden Sie Ihr erstes Dokument", body: "Es dauert etwa zwei Minuten: PDF hochladen, Felder setzen, festlegen, wer unterschreibt, senden. Es wird nichts berechnet, und die unterzeichnende Person braucht kein Konto.", cta: "Dokument senden" },
      { subject: "Speichern Sie ein oft gesendetes Dokument", body: "Wenn Sie dasselbe Dokument immer wieder senden, speichern Sie es als Vorlage. Beim nächsten Mal genügt ein Klick: Felder und Text sind schon da.", cta: "Vorlagen öffnen" },
      { subject: "Laden Sie eine Kollegin oder einen Kollegen ein", body: "Ein Teammitglied kann mit Ihnen Dokumente senden und verfolgen, damit nichts an einer Person hängt. Fügen Sie es per E-Mail hinzu; die Anmeldung erfolgt mit einem Code.", cta: "Teammitglied einladen" },
    ],
    foot: { why: "Sie erhalten diese Nachricht, weil Sie ein Docustay-Konto erstellt haben. Es ist eine von vier kurzen E-Mails Ihrer ersten Woche.", unsub: "Diese E-Mails abbestellen", settings: "Oder schalten Sie sie unter Einstellungen, Konto aus." },
  },
  pt: {
    steps: [
      { subject: "Boas-vindas ao Docustay", body: "Seu espaço de trabalho está pronto. Envie um PDF, posicione os campos de assinatura e mande: quem assina recebe um link e você recebe uma cópia selada com certificado.", cta: "Enviar seu primeiro documento" },
      { subject: "Envie seu primeiro documento", body: "Leva cerca de dois minutos: envie um PDF, posicione os campos, diga quem assina e mande. Nada é cobrado e quem assina não precisa de conta.", cta: "Enviar um documento" },
      { subject: "Salve o documento que você envia com frequência", body: "Se você envia sempre o mesmo documento, salve-o como modelo. Da próxima vez basta um clique: os campos e o texto já estão lá.", cta: "Abrir modelos" },
      { subject: "Convide um colega", body: "Um colega pode enviar e acompanhar documentos com você, e nada depende de uma só pessoa. Adicione por e-mail; ele entra com um código.", cta: "Convidar um colega" },
    ],
    foot: { why: "Você recebe esta mensagem porque criou uma conta no Docustay. É um de quatro e-mails curtos da sua primeira semana.", unsub: "Parar de receber estes e-mails", settings: "Ou desative em Configurações, Conta." },
  },
  it: {
    steps: [
      { subject: "Benvenuto su Docustay", body: "Il tuo spazio di lavoro è pronto. Carica un PDF, posiziona i campi firma e invialo: chi firma riceve un link e tu ricevi una copia sigillata con certificato.", cta: "Invia il tuo primo documento" },
      { subject: "Invia il tuo primo documento", body: "Bastano circa due minuti: carica un PDF, posiziona i campi, indica chi firma e invia. Non viene addebitato nulla e chi firma non ha bisogno di un account.", cta: "Invia un documento" },
      { subject: "Salva il documento che invii spesso", body: "Se invii sempre lo stesso documento, salvalo come modello. La prossima volta basta un clic: campi e testo sono già pronti.", cta: "Apri i modelli" },
      { subject: "Invita un collega", body: "Un collega può inviare e seguire documenti con te, così nulla dipende da una sola persona. Aggiungilo via e-mail; accede con un codice.", cta: "Invita un collega" },
    ],
    foot: { why: "Ricevi questo messaggio perché hai creato un account Docustay. È una delle quattro brevi e-mail della tua prima settimana.", unsub: "Non ricevere più queste e-mail", settings: "Oppure disattivale in Impostazioni, Account." },
  },
  nl: {
    steps: [
      { subject: "Welkom bij Docustay", body: "Uw werkruimte is klaar. Upload een pdf, plaats de handtekeningvelden en verstuur hem: de ondertekenaar krijgt een link en u krijgt een verzegeld exemplaar met certificaat.", cta: "Verstuur uw eerste document" },
      { subject: "Verstuur uw eerste document", body: "Het kost ongeveer twee minuten: pdf uploaden, velden plaatsen, aangeven wie tekent en versturen. Er wordt niets in rekening gebracht en de ondertekenaar hoeft geen account te hebben.", cta: "Document versturen" },
      { subject: "Bewaar een document dat u vaak verstuurt", body: "Als u steeds hetzelfde document verstuurt, bewaar het dan als sjabloon. De volgende keer is het één klik: de velden en de tekst staan al klaar.", cta: "Sjablonen openen" },
      { subject: "Nodig een collega uit", body: "Een collega kan samen met u documenten versturen en volgen, zodat niets van één persoon afhangt. Voeg hem of haar toe via e-mail; inloggen gaat met een code.", cta: "Collega uitnodigen" },
    ],
    foot: { why: "U ontvangt dit bericht omdat u een Docustay-account hebt gemaakt. Het is een van vier korte e-mails in uw eerste week.", unsub: "Geen e-mails meer ontvangen", settings: "Of zet ze uit via Instellingen, Account." },
  },
  pl: {
    steps: [
      { subject: "Witamy w Docustay", body: "Twoja przestrzeń robocza jest gotowa. Prześlij plik PDF, umieść pola podpisu i wyślij go: osoba podpisująca dostaje link, a the maintainer otrzymujesz zapieczętowaną kopię z certyfikatem.", cta: "Wyślij pierwszy dokument" },
      { subject: "Wyślij pierwszy dokument", body: "Zajmuje to około dwóch minut: prześlij PDF, umieść pola, wskaż, kto podpisuje, i wyślij. Nic nie jest pobierane, a podpisujący nie potrzebuje konta.", cta: "Wyślij dokument" },
      { subject: "Zapisz dokument, który często wysyłasz", body: "Jeśli wysyłasz ciągle ten sam dokument, zapisz go jako szablon. Następnym razem wystarczy jedno kliknięcie: pola i treść już tam są.", cta: "Otwórz szablony" },
      { subject: "Zaproś współpracownika", body: "Współpracownik może razem z Tobą wysyłać i śledzić dokumenty, więc nic nie zależy od jednej osoby. Dodaj go e-mailem; loguje się kodem.", cta: "Zaproś współpracownika" },
    ],
    foot: { why: "Otrzymujesz tę wiadomość, ponieważ utworzono konto Docustay. To jedna z czterech krótkich wiadomości w pierwszym tygodniu.", unsub: "Nie wysyłajcie mi tych e-maili", settings: "Możesz też wyłączyć je w Ustawieniach, Konto." },
  },
  tr: {
    steps: [
      { subject: "Docustay'e hoş geldiniz", body: "Çalışma alanınız hazır. Bir PDF yükleyin, imza alanlarını yerleştirin ve gönderin: imzalayan kişi bir bağlantı alır, siz sertifikalı, mühürlü bir kopya alırsınız.", cta: "İlk belgenizi gönderin" },
      { subject: "İlk belgenizi gönderin", body: "Yaklaşık iki dakika sürer: PDF yükleyin, alanları yerleştirin, kimin imzalayacağını belirtin ve gönderin. Hiçbir ücret alınmaz ve imzalayanın hesabı olması gerekmez.", cta: "Belge gönder" },
      { subject: "Sık gönderdiğiniz belgeyi kaydedin", body: "Aynı belgeyi tekrar tekrar gönderiyorsanız şablon olarak kaydedin. Bir sonraki sefer tek tıklama yeter: alanlar ve metin hazır olur.", cta: "Şablonları aç" },
      { subject: "Bir ekip arkadaşı davet edin", body: "Ekip arkadaşınız sizinle birlikte belge gönderip takip edebilir; böylece hiçbir şey tek kişiye bağlı kalmaz. E-posta ile ekleyin; bir kodla giriş yapar.", cta: "Ekip arkadaşı davet et" },
    ],
    foot: { why: "Bu iletiyi, bir Docustay hesabı oluşturduğunuz için alıyorsunuz. İlk haftanızdaki dört kısa e-postadan biridir.", unsub: "Bu e-postaları durdur", settings: "Ya da Ayarlar, Hesap bölümünden kapatın." },
  },
  ru: {
    steps: [
      { subject: "Добро пожаловать в Docustay", body: "Ваше рабочее пространство готово. Загрузите PDF, расставьте поля для подписи и отправьте: подписывающий получит ссылку, а вы — запечатанную копию с сертификатом.", cta: "Отправить первый документ" },
      { subject: "Отправьте первый документ", body: "Это займёт около двух минут: загрузите PDF, расставьте поля, укажите, кто подписывает, и отправьте. Ничего не списывается, а подписывающему не нужна учётная запись.", cta: "Отправить документ" },
      { subject: "Сохраните документ, который вы часто отправляете", body: "Если вы снова и снова отправляете один и тот же документ, сохраните его как шаблон. В следующий раз хватит одного клика: поля и текст уже готовы.", cta: "Открыть шаблоны" },
      { subject: "Пригласите коллегу", body: "Коллега сможет вместе с вами отправлять и отслеживать документы, и всё не будет держаться на одном человеке. Добавьте его по почте; вход — по коду.", cta: "Пригласить коллегу" },
    ],
    foot: { why: "Вы получаете это письмо, потому что создали учётную запись Docustay. Это одно из четырёх коротких писем первой недели.", unsub: "Больше не получать эти письма", settings: "Или отключите их в Настройках, Учётная запись." },
  },
  ar: {
    steps: [
      { subject: "مرحبًا بك في Docustay", body: "مساحة عملك جاهزة. ارفع ملف PDF وضع حقول التوقيع ثم أرسله: يصل الموقّع رابط، وتصلك نسخة مختومة مع شهادة.", cta: "أرسل أول مستند" },
      { subject: "أرسل أول مستند", body: "يستغرق الأمر نحو دقيقتين: ارفع ملف PDF، وضع الحقول، وحدّد من سيوقّع، ثم أرسل. لا يُحتسب أي رسم ولا يحتاج الموقّع إلى حساب.", cta: "أرسل مستندًا" },
      { subject: "احفظ المستند الذي ترسله كثيرًا", body: "إذا كنت ترسل المستند نفسه مرارًا فاحفظه كقالب. في المرة القادمة تكفي نقرة واحدة: الحقول والنص جاهزة.", cta: "افتح القوالب" },
      { subject: "ادعُ زميلًا", body: "يستطيع زميلك إرسال المستندات ومتابعتها معك فلا يعتمد كل شيء على شخص واحد. أضفه بالبريد الإلكتروني؛ يسجّل الدخول برمز.", cta: "ادعُ زميلًا" },
    ],
    foot: { why: "تصلك هذه الرسالة لأنك أنشأت حسابًا في Docustay. وهي واحدة من أربع رسائل قصيرة في أسبوعك الأول.", unsub: "إيقاف هذه الرسائل", settings: "أو أوقفها من الإعدادات، الحساب." },
  },
  ja: {
    steps: [
      { subject: "Docustay へようこそ", body: "ワークスペースの準備ができました。PDF をアップロードして署名欄を配置し、送信してください。署名者にはリンクが届き、あなたには証明書付きの封印済みコピーが届きます。", cta: "最初の文書を送る" },
      { subject: "最初の文書を送りましょう", body: "所要時間は約 2 分です。PDF をアップロードし、欄を配置し、署名者を指定して送信します。料金はかからず、署名者のアカウントも不要です。", cta: "文書を送る" },
      { subject: "よく送る文書を保存しましょう", body: "同じ文書を何度も送るなら、テンプレートとして保存してください。次回は 1 クリックで、欄も文面もそのまま使えます。", cta: "テンプレートを開く" },
      { subject: "チームメンバーを招待しましょう", body: "チームメンバーも一緒に文書を送信・追跡できるので、特定の人に頼りきりになりません。メールで追加すると、コードでサインインできます。", cta: "メンバーを招待する" },
    ],
    foot: { why: "Docustay アカウントを作成されたため、このメールをお送りしています。最初の 1 週間にお送りする短い 4 通のうちの 1 通です。", unsub: "このメールの配信を停止する", settings: "または「設定」の「アカウント」でオフにできます。" },
  },
  zh: {
    steps: [
      { subject: "欢迎使用 Docustay", body: "您的工作区已就绪。上传 PDF，放置签名栏并发送：签署人会收到链接，您会收到带证书的密封副本。", cta: "发送您的第一份文件" },
      { subject: "发送您的第一份文件", body: "大约需要两分钟：上传 PDF、放置字段、指定签署人并发送。不会收取任何费用，签署人也无需账号。", cta: "发送文件" },
      { subject: "保存您常发的文件", body: "如果您反复发送同一份文件，请将它保存为模板。下次只需一次点击：字段和文字都已就绪。", cta: "打开模板" },
      { subject: "邀请一位同事", body: "同事可以和您一起发送并跟踪文件，不再依赖某一个人。通过邮箱添加即可，对方使用验证码登录。", cta: "邀请同事" },
    ],
    foot: { why: "您收到此邮件，是因为您创建了 Docustay 账号。这是您第一周内四封简短邮件中的一封。", unsub: "不再接收这些邮件", settings: "也可以在“设置”的“账号”中关闭。" },
  },
  ko: {
    steps: [
      { subject: "Docustay에 오신 것을 환영합니다", body: "워크스페이스가 준비되었습니다. PDF를 올리고 서명란을 배치한 뒤 보내세요. 서명자는 링크를 받고, 여러분은 인증서가 포함된 봉인된 사본을 받습니다.", cta: "첫 문서 보내기" },
      { subject: "첫 문서를 보내 보세요", body: "약 2분이면 됩니다. PDF를 올리고, 필드를 배치하고, 서명할 사람을 지정한 뒤 보내세요. 비용은 청구되지 않으며 서명자는 계정이 필요 없습니다.", cta: "문서 보내기" },
      { subject: "자주 보내는 문서를 저장하세요", body: "같은 문서를 계속 보낸다면 템플릿으로 저장하세요. 다음에는 클릭 한 번이면 됩니다. 필드와 문구가 이미 준비되어 있습니다.", cta: "템플릿 열기" },
      { subject: "팀원을 초대하세요", body: "팀원도 함께 문서를 보내고 추적할 수 있어 한 사람에게만 의존하지 않습니다. 이메일로 추가하면 코드로 로그인합니다.", cta: "팀원 초대하기" },
    ],
    foot: { why: "Docustay 계정을 만드셨기 때문에 이 메일을 받으셨습니다. 첫 주에 보내는 짧은 4통 중 하나입니다.", unsub: "이 이메일 수신 중지", settings: "또는 설정의 계정에서 끌 수 있습니다." },
  },
};
/** The words for one step (0 welcome, 1/2/3) in a language, English when the language has none. Returns { subject, body, cta, foot }. */
export function welcomeWords(lang, step) {
  const base = String(lang ?? "en").toLowerCase().split("-")[0];
  const l = WELCOME[base] ?? WELCOME.en;
  const s = l.steps[step] ?? WELCOME.en.steps[step];
  return { ...s, foot: l.foot };
}
