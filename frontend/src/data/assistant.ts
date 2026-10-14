import type { LanguageCode } from '../types'

export interface AssistantAction {
  label: string
  route: string
  /** Passed as router state, e.g. { open: 'upload' } */
  state?: Record<string, string>
}

export interface CannedReply {
  keywords: string[]
  en: string
  hi: string
  actions?: AssistantAction[]
  /** If set, the assistant navigates here automatically. */
  autoRoute?: string
}

export const assistantLanguages: { code: LanguageCode; label: string }[] = [
  { code: 'en', label: 'English' },
  { code: 'hi', label: 'हिन्दी' },
  { code: 'te', label: 'తెలుగు' },
  { code: 'ta', label: 'தமிழ்' },
  { code: 'kn', label: 'ಕನ್ನಡ' },
  { code: 'mr', label: 'मराठी' },
  { code: 'bn', label: 'বাংলা' },
]

export const suggestedQuestions = [
  'Why is there a dip on Day 34?',
  'How do I add a supplier?',
  'Upload my Excel',
  'Take me to the forecast',
]

export const voiceTranscripts = [
  'Why is there a dip on Day 34?',
  'Who owes me money right now?',
  'Take me to the forecast',
]

export const cannedReplies: CannedReply[] = [
  {
    keywords: ['take me to the forecast', 'open forecast', 'go to forecast', 'show forecast', 'forecast page'],
    autoRoute: '/forecast',
    en: 'Opening your 90-day forecast now.',
    hi: 'आपका 90 दिन का फ़ोरकास्ट खोल रहा हूँ।',
    actions: [{ label: 'Open forecast', route: '/forecast' }],
  },
  {
    keywords: ['take me to khata', 'open khata', 'go to khata', 'ledger page'],
    autoRoute: '/khata',
    en: 'Opening your khata.',
    hi: 'आपका खाता खोल रहा हूँ।',
    actions: [{ label: 'Open khata', route: '/khata' }],
  },
  {
    keywords: ['take me home', 'go home', 'open engine', 'home page'],
    autoRoute: '/',
    en: 'Taking you to the engine view.',
    hi: 'आपको इंजन व्यू पर ले जा रहा हूँ।',
    actions: [{ label: 'Open engine', route: '/' }],
  },
  {
    keywords: ['dip', 'day 34', 'shortfall', 'run out', 'short'],
    en: 'Your balance falls about ₹1.2L below zero on Day 34. Two things collide: the ₹3.52L payment to Sharma Yarn Mills is due that day, and Kaveri Boutique has not paid its ₹1.45L bill, which is already overdue. The forecast expects that money around Day 41, a week too late. Pick a fix on the forecast page and I can draft the WhatsApp message.',
    hi: 'Day 34 पर आपका बैलेंस लगभग ₹1.2L ज़ीरो से नीचे चला जाता है। दो बातें एक साथ टकराती हैं: उसी दिन Sharma Yarn Mills को ₹3.52L देने हैं, और Kaveri Boutique का ₹1.45L का बिल अब भी बाकी है। यह पैसा Day 41 के आसपास आने की उम्मीद है, यानी एक हफ़्ता देर से। फ़ोरकास्ट पेज पर कोई उपाय चुनें, मैं WhatsApp संदेश तैयार कर दूँगा।',
    actions: [{ label: 'See ways to fix it', route: '/forecast' }],
  },
  {
    keywords: ['add a supplier', 'add supplier', 'new supplier'],
    en: 'Open Khata and choose "+ Add supplier". Enter the name, phone, what they supply, the total and what you have already paid. The amount you owe is worked out for you. Add the supply date and payment due date too, because the forecast uses them.',
    hi: 'खाता खोलें और "+ Add supplier" चुनें। नाम, फ़ोन, सप्लाई का सामान, कुल रकम और जो चुका चुके हैं वह भरें। बकाया रकम अपने आप निकल जाएगी। सप्लाई की तारीख और भुगतान की अंतिम तारीख भी भरें, क्योंकि फ़ोरकास्ट इन्हीं से बनता है।',
    actions: [{ label: 'Add a supplier', route: '/khata', state: { open: 'supplier' } }],
  },
  {
    keywords: ['add a customer', 'add customer', 'new customer'],
    en: 'Open Khata and choose "+ Add customer". Fill in the shop, what you sold, the bill total and what they have paid. Ripple works out what they still owe.',
    hi: 'खाता खोलें और "+ Add customer" चुनें। दुकान, बेचा गया सामान, बिल की कुल रकम और उनका दिया हुआ पैसा भरें। बाकी रकम Ripple खुद निकाल लेगा।',
    actions: [{ label: 'Add a customer', route: '/khata', state: { open: 'customer' } }],
  },
  {
    keywords: ['upload', 'excel', 'csv', 'spreadsheet', 'import'],
    en: 'You can bring in your whole ledger at once. Drop an Excel or CSV file, check how its columns match, and import. Not sure about the format? Download the template first.',
    hi: 'आप पूरा खाता एक साथ डाल सकते हैं। Excel या CSV फ़ाइल डालें, कॉलम का मिलान जाँचें और इम्पोर्ट करें। फ़ॉर्मैट पक्का नहीं है? पहले टेम्पलेट डाउनलोड करें।',
    actions: [{ label: 'Open upload', route: '/khata', state: { open: 'upload' } }],
  },
  {
    keywords: ['whatsapp', 'message', 'remind'],
    en: 'On the forecast page, pick a fix and a ready-to-send WhatsApp message appears. You can switch between a polite and a firm tone, change the language and edit the text before sending.',
    hi: 'फ़ोरकास्ट पेज पर कोई उपाय चुनें, तुरंत भेजने लायक WhatsApp संदेश दिख जाएगा। आप विनम्र या सख़्त लहजा चुन सकते हैं, भाषा बदल सकते हैं और भेजने से पहले संदेश बदल सकते हैं।',
    actions: [{ label: 'Open forecast', route: '/forecast' }],
  },
  {
    keywords: ['owe me', 'owes me', 'receive', 'customers', 'overdue'],
    en: 'Customers owe you ₹7.86L in total. Kaveri Boutique is the one to chase first: ₹1.45L, already 12 days overdue.',
    hi: 'ग्राहकों पर आपका कुल ₹7.86L बकाया है। सबसे पहले Kaveri Boutique से बात करें: ₹1.45L, जो 12 दिन से लेट है।',
    actions: [{ label: 'Open khata', route: '/khata' }],
  },
  {
    keywords: ['cash', 'balance', 'how much'],
    en: 'You have ₹2,30,000 in cash today. Over the next 90 days you expect ₹8.76L in and ₹8.29L out, which leaves you ₹47,000 ahead, but the balance dips below zero on Day 34.',
    hi: 'आज आपके पास ₹2,30,000 नकद है। अगले 90 दिनों में ₹8.76L आने और ₹8.29L जाने की उम्मीद है, यानी ₹47,000 का फ़ायदा, लेकिन Day 34 पर बैलेंस ज़ीरो से नीचे जाता है।',
  },
  {
    keywords: ['hello', 'hi', 'hey', 'namaste', 'help'],
    en: 'Hello! I can explain your forecast, help you add customers or suppliers, or take you to any page. What would you like to do?',
    hi: 'नमस्ते! मैं आपका फ़ोरकास्ट समझा सकता हूँ, ग्राहक या सप्लायर जोड़ने में मदद कर सकता हूँ, या किसी भी पेज पर ले जा सकता हूँ। आप क्या करना चाहेंगे?',
  },
]

export const fallbackReply: CannedReply = {
  keywords: [],
  en: 'I can help with your forecast, the Day 34 dip, adding customers or suppliers, uploading a file, or WhatsApp reminders. Try one of the suggestions below.',
  hi: 'मैं फ़ोरकास्ट, Day 34 की कमी, ग्राहक या सप्लायर जोड़ने, फ़ाइल अपलोड करने और WhatsApp संदेशों में मदद कर सकता हूँ। नीचे दिए सुझावों में से कोई चुनें।',
}

export function matchReply(input: string): CannedReply {
  const text = input.toLowerCase()
  // Longer keywords first so specific phrases win over generic ones.
  const scored = cannedReplies
    .map((r) => {
      const hit = r.keywords.filter((k) => text.includes(k)).sort((a, b) => b.length - a.length)[0]
      return { r, score: hit ? hit.length : 0 }
    })
    .filter((x) => x.score > 0)
    .sort((a, b) => b.score - a.score)
  return scored[0]?.r ?? fallbackReply
}
