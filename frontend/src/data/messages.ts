import type { LanguageCode, Tone } from '../types'

export interface MessageContext {
  business: string
  party: string
  amount: string
  discounted: string
  half: string
  /** e.g. "13 Nov" – date to pay early */
  earlyDate: string
  dueDate: string
  laterDate: string
}

type Template = (c: MessageContext) => string

type Bank = Record<string, Record<Tone, Template>>

const en: Bank = {
  'early-payment': {
    polite: (c) =>
      `Namaste ${c.party} ji 🙏\nHope business is going well. Our invoice of ${c.amount} from ${c.business} is still pending. If you can clear it by ${c.earlyDate}, we'll gladly give you a 2% discount, so you pay only ${c.discounted}.\nLet us know and we'll share the UPI details. Thank you!`,
    firm: (c) =>
      `Hello ${c.party},\nYour payment of ${c.amount} to ${c.business} is overdue. Please clear it by ${c.earlyDate}. Payment by then gets 2% off (${c.discounted}). After that the full amount applies and we will have to hold new orders.\nPlease confirm today.`,
  },
  'split-payment': {
    polite: (c) =>
      `Namaste ${c.party} ji 🙏\nThank you for the steady supply. Our payment of ${c.amount} is due on ${c.dueDate}. Could we pay ${c.half} on ${c.dueDate} and the remaining ${c.half} by ${c.laterDate}? A few customer payments are landing just after the due date. We value the relationship and will keep the second part on time.`,
    firm: (c) =>
      `Hello ${c.party},\nWe will settle the ${c.amount} invoice in two parts: ${c.half} on ${c.dueDate} and ${c.half} by ${c.laterDate}. Please confirm by tomorrow so we can plan the next order.`,
  },
  extension: {
    polite: (c) =>
      `Namaste ${c.party} ji 🙏\nThank you for your support. Could you give us a 10-day extension on the ${c.amount} payment, from ${c.dueDate} to ${c.laterDate}? A customer payment is delayed and we want to pay you in full, without any partial amounts. We will confirm the transfer on ${c.laterDate}.`,
    firm: (c) =>
      `Hello ${c.party},\nWe need to move the ${c.amount} payment from ${c.dueDate} to ${c.laterDate}. Full payment will reach you on that date. Please confirm the new date today.`,
  },
  'invoice-financing': {
    polite: (c) =>
      `Hello BillBridge team,\nI would like to finance one pending invoice of ${c.amount} raised on ${c.party}. Could you share your advance rate, fees and the documents you need? We can submit them by ${c.earlyDate}. Thank you!`,
    firm: (c) =>
      `Hello BillBridge team,\nPlease start invoice financing for ${c.amount} on ${c.party}. We need the advance by ${c.earlyDate}. Send your fee sheet and checklist today.`,
  },
}

const hi: Bank = {
  'early-payment': {
    polite: (c) =>
      `नमस्ते ${c.party} जी 🙏\nआशा है आपका व्यापार अच्छा चल रहा है। ${c.business} का ${c.amount} का बिल अभी बाकी है। अगर आप इसे ${c.earlyDate} तक चुका दें तो हम 2% छूट देंगे, यानी आप सिर्फ़ ${c.discounted} देंगे।\nबताइए, हम UPI डिटेल्स भेज देते हैं। धन्यवाद!`,
    firm: (c) =>
      `${c.party} जी,\n${c.business} का ${c.amount} का भुगतान लंबित है। कृपया इसे ${c.earlyDate} तक चुका दें। तब तक भुगतान करने पर 2% छूट मिलेगी (${c.discounted})। उसके बाद पूरी रकम देनी होगी और नए ऑर्डर रोकने पड़ेंगे।\nकृपया आज ही पुष्टि करें।`,
  },
  'split-payment': {
    polite: (c) =>
      `नमस्ते ${c.party} जी 🙏\nसमय पर माल भेजने के लिए धन्यवाद। हमारा ${c.amount} का भुगतान ${c.dueDate} को देय है। क्या हम ${c.dueDate} को ${c.half} और बाकी ${c.half} ${c.laterDate} तक दे सकते हैं? कुछ ग्राहकों का भुगतान देय तारीख के ठीक बाद आ रहा है। हम आपके साथ रिश्ते की कद्र करते हैं और दूसरा हिस्सा समय पर देंगे।`,
    firm: (c) =>
      `${c.party} जी,\nहम ${c.amount} का बिल दो हिस्सों में चुकाएँगे: ${c.dueDate} को ${c.half} और ${c.laterDate} तक ${c.half}। अगला ऑर्डर तय करने के लिए कृपया कल तक पुष्टि करें।`,
  },
  extension: {
    polite: (c) =>
      `नमस्ते ${c.party} जी 🙏\nआपके सहयोग के लिए धन्यवाद। क्या आप ${c.amount} के भुगतान की तारीख ${c.dueDate} से बढ़ाकर ${c.laterDate} कर सकते हैं? एक ग्राहक का भुगतान देर से आ रहा है और हम आपको पूरा भुगतान एक साथ करना चाहते हैं। ${c.laterDate} को हम ट्रांसफ़र की पुष्टि कर देंगे।`,
    firm: (c) =>
      `${c.party} जी,\nहमें ${c.amount} का भुगतान ${c.dueDate} से ${c.laterDate} पर ले जाना होगा। पूरी रकम उसी दिन पहुँच जाएगी। कृपया आज ही नई तारीख की पुष्टि करें।`,
  },
  'invoice-financing': {
    polite: (c) =>
      `नमस्ते BillBridge टीम,\nमैं ${c.party} पर बने ${c.amount} के एक बकाया बिल का फ़ाइनेंस कराना चाहता हूँ। कृपया अपनी एडवांस दर, शुल्क और ज़रूरी दस्तावेज़ बताइए। हम ${c.earlyDate} तक जमा कर देंगे। धन्यवाद!`,
    firm: (c) =>
      `नमस्ते BillBridge टीम,\n${c.party} पर ${c.amount} के बिल की फ़ाइनेंसिंग शुरू कीजिए। हमें ${c.earlyDate} तक एडवांस चाहिए। कृपया आज ही शुल्क-सूची और चेकलिस्ट भेजें।`,
  },
}

const banks: Partial<Record<LanguageCode, Bank>> = { en, hi }

export const messageLanguages: { code: LanguageCode; label: string; available: boolean }[] = [
  { code: 'en', label: 'English', available: true },
  { code: 'hi', label: 'हिन्दी (Hindi)', available: true },
  { code: 'te', label: 'తెలుగు (Telugu)', available: false },
  { code: 'ta', label: 'தமிழ் (Tamil)', available: false },
  { code: 'kn', label: 'ಕನ್ನಡ (Kannada)', available: false },
]

/** Returns the message and whether the requested language was available (otherwise English is returned). */
export function buildMessage(
  fixId: string,
  tone: Tone,
  lang: LanguageCode,
  ctx: MessageContext,
): { text: string; usedLanguage: LanguageCode } {
  const bank = banks[lang]
  const used: LanguageCode = bank ? lang : 'en'
  const template = (bank ?? en)[fixId]?.[tone] ?? en['early-payment'][tone]
  return { text: template(ctx), usedLanguage: used }
}
