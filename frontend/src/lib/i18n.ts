/**
 * UI strings. Tamil and Hindi need review by a fluent speaker before real use (PRD 17.12);
 * untranslated keys fall back to English.
 */
import i18n from 'i18next'
import { initReactI18next } from 'react-i18next'

const en = {
  nav: { today: 'Today', engine: 'Engine', book: 'Book', khata: 'Khata', orders: 'Orders', inventory: 'Inventory', settings: 'Settings' },
  common: {
    cashNow: 'Cash now', toReceive: 'To receive', toPay: 'To pay', runway: 'Runway', net: 'Net', days: '{{count}} days',
    customers: '{{count}} customers', suppliers: '{{count}} suppliers', bufferBreach: 'buffer breach {{date}}', noShortfall: 'no shortfall in {{days}} days',
    remind: 'Remind', recordPayment: 'Record payment', markPaid: 'Mark paid', received: 'Received', createPO: 'Create PO', showInEngine: 'Show in Engine',
    seeWhy: 'See why', tryFix: 'Try a fix', explain: 'Explain with Munim', close: 'Close', cancel: 'Cancel', save: 'Save', loading: 'Loading',
    in: 'In', out: 'Out', balance: 'Balance', date: 'Date', party: 'Party', details: 'Details', medium: 'Medium', ref: 'Ref',
  },
  today: {
    doToday: 'Do today', thisWeek: 'This week', fromSuppliers: 'From suppliers', toCustomers: 'To customers', moneyToday: 'Money today',
    awaited: 'Awaited', receivedToday: 'Received today', toDeliver: 'To deliver', deliveredToday: 'Delivered today', dueIn: 'Due in', dueOut: 'Due out',
    changed: 'What changed since the last run', lots: '{{count}} lots', ordersCount: '{{count}} orders', nothing: 'Nothing urgent today.',
    covered: 'You can cover everything due this week.', notCovered: 'Not everything due this week can be paid.',
    shortfall: 'Cash runs short on {{date}}: {{amount}} cannot be paid.',
    breach: 'Cash falls below your {{buffer}} buffer on {{date}}.',
    safe: 'No shortfall in the next {{days}} days.',
    unless: 'unless {{party}} pays {{amount}}.',
    chase: 'Chase {{party}}', pay: 'Pay {{party}}', confirm: 'Confirm goods from {{party}}', stock: 'Material short for {{order}}',
    overdueRisk: '{{days}} days overdue · {{share}} of your risk', overdue: '{{days}} days overdue', due: 'due {{date}}',
  },
  book: { ledgerIn: 'In', ledgerOut: 'Out', position: 'Position', goods: 'Goods', why: 'Why the dip happens', fixes: 'Ways to fix it', transactions: 'Transactions', risk: 'Risk' },
}

type Dict = typeof en

const ta: Dict = {
  nav: { today: 'இன்று', engine: 'இயந்திரம்', book: 'கணக்கு', khata: 'கணக்கேடு', orders: 'ஆர்டர்கள்', inventory: 'சரக்கு', settings: 'அமைப்புகள்' },
  common: {
    cashNow: 'கையிருப்பு', toReceive: 'வர வேண்டியது', toPay: 'கொடுக்க வேண்டியது', runway: 'பணம் போதும் காலம்', net: 'நிகரம்', days: '{{count}} நாட்கள்',
    customers: '{{count}} வாடிக்கையாளர்கள்', suppliers: '{{count}} சப்ளையர்கள்', bufferBreach: 'இருப்பு வரம்புக்குக் கீழ் {{date}}', noShortfall: '{{days}} நாட்களில் பற்றாக்குறை இல்லை',
    remind: 'நினைவூட்டு', recordPayment: 'பணம் பதிவு', markPaid: 'செலுத்தியது', received: 'வந்தது', createPO: 'ஆர்டர் போடு', showInEngine: 'இயந்திரத்தில் காட்டு',
    seeWhy: 'ஏன் என்று பார்', tryFix: 'தீர்வு முயற்சி', explain: 'முனீமிடம் விளக்கம்', close: 'மூடு', cancel: 'ரத்து', save: 'சேமி', loading: 'ஏற்றுகிறது',
    in: 'வரவு', out: 'செலவு', balance: 'இருப்பு', date: 'தேதி', party: 'நபர்', details: 'விவரம்', medium: 'முறை', ref: 'குறிப்பு',
  },
  today: {
    doToday: 'இன்று செய்ய வேண்டியவை', thisWeek: 'இந்த வாரம்', fromSuppliers: 'சப்ளையர்களிடமிருந்து', toCustomers: 'வாடிக்கையாளர்களுக்கு', moneyToday: 'இன்றைய பணம்',
    awaited: 'எதிர்பார்ப்பு', receivedToday: 'இன்று வந்தது', toDeliver: 'அனுப்ப வேண்டியது', deliveredToday: 'இன்று அனுப்பியது', dueIn: 'வர வேண்டியது', dueOut: 'கொடுக்க வேண்டியது',
    changed: 'கடைசி கணக்கீட்டிலிருந்து மாற்றம்', lots: '{{count}} சரக்குகள்', ordersCount: '{{count}} ஆர்டர்கள்', nothing: 'இன்று அவசரம் எதுவும் இல்லை.',
    covered: 'இந்த வாரம் செலுத்த வேண்டிய அனைத்தையும் செலுத்தலாம்.', notCovered: 'இந்த வாரம் செலுத்த வேண்டிய அனைத்தையும் செலுத்த முடியாது.',
    shortfall: '{{date}} அன்று பணம் போதாது: {{amount}} செலுத்த முடியாது.',
    breach: '{{date}} அன்று உங்கள் {{buffer}} இருப்பு வரம்புக்குக் கீழ் பணம் குறையும்.',
    safe: 'அடுத்த {{days}} நாட்களில் பற்றாக்குறை இல்லை.',
    unless: '{{party}} {{amount}} செலுத்தினால் தவிர.',
    chase: '{{party}} இடம் வசூலி', pay: '{{party}} க்குச் செலுத்து', confirm: '{{party}} சரக்கை உறுதிசெய்', stock: '{{order}} க்குப் பொருள் குறைவு',
    overdueRisk: '{{days}} நாட்கள் தாமதம் · உங்கள் அபாயத்தில் {{share}}', overdue: '{{days}} நாட்கள் தாமதம்', due: '{{date}} செலுத்த வேண்டும்',
  },
  book: { ledgerIn: 'வரவு', ledgerOut: 'செலவு', position: 'நிலை', goods: 'சரக்கு', why: 'ஏன் குறைவு', fixes: 'தீர்வுகள்', transactions: 'பரிவர்த்தனைகள்', risk: 'அபாயம்' },
}

const hi: Dict = {
  nav: { today: 'आज', engine: 'इंजन', book: 'बही', khata: 'खाता', orders: 'ऑर्डर', inventory: 'माल', settings: 'सेटिंग्स' },
  common: {
    cashNow: 'नकद अभी', toReceive: 'लेना है', toPay: 'देना है', runway: 'नकद कितने दिन', net: 'शुद्ध', days: '{{count}} दिन',
    customers: '{{count}} ग्राहक', suppliers: '{{count}} सप्लायर', bufferBreach: 'सुरक्षा राशि से नीचे {{date}}', noShortfall: '{{days}} दिनों में कोई कमी नहीं',
    remind: 'याद दिलाएँ', recordPayment: 'भुगतान दर्ज करें', markPaid: 'भुगतान हुआ', received: 'माल आया', createPO: 'ऑर्डर दें', showInEngine: 'इंजन में देखें',
    seeWhy: 'क्यों, देखें', tryFix: 'समाधान आज़माएँ', explain: 'मुनीम से समझें', close: 'बंद करें', cancel: 'रद्द करें', save: 'सहेजें', loading: 'लोड हो रहा है',
    in: 'जमा', out: 'नाम', balance: 'शेष', date: 'तारीख', party: 'पार्टी', details: 'विवरण', medium: 'माध्यम', ref: 'संदर्भ',
  },
  today: {
    doToday: 'आज करें', thisWeek: 'इस सप्ताह', fromSuppliers: 'सप्लायरों से', toCustomers: 'ग्राहकों को', moneyToday: 'आज का पैसा',
    awaited: 'आना बाकी', receivedToday: 'आज आया', toDeliver: 'भेजना बाकी', deliveredToday: 'आज भेजा', dueIn: 'आना है', dueOut: 'देना है',
    changed: 'पिछली गणना के बाद क्या बदला', lots: '{{count}} लॉट', ordersCount: '{{count}} ऑर्डर', nothing: 'आज कुछ ज़रूरी नहीं।',
    covered: 'इस सप्ताह का सारा भुगतान हो सकता है।', notCovered: 'इस सप्ताह का पूरा भुगतान नहीं हो पाएगा।',
    shortfall: '{{date}} को नकद कम पड़ेगा: {{amount}} का भुगतान नहीं हो पाएगा।',
    breach: '{{date}} को नकद आपकी {{buffer}} सुरक्षा राशि से नीचे जाएगा।',
    safe: 'अगले {{days}} दिनों में कोई कमी नहीं।',
    unless: 'जब तक {{party}} {{amount}} नहीं देता।',
    chase: '{{party}} से वसूली करें', pay: '{{party}} को भुगतान करें', confirm: '{{party}} का माल पक्का करें', stock: '{{order}} के लिए माल कम',
    overdueRisk: '{{days}} दिन देर · आपके जोखिम का {{share}}', overdue: '{{days}} दिन देर', due: '{{date}} को देय',
  },
  book: { ledgerIn: 'जमा', ledgerOut: 'नाम', position: 'स्थिति', goods: 'माल', why: 'कमी क्यों', fixes: 'समाधान', transactions: 'लेन-देन', risk: 'जोखिम' },
}

void i18n.use(initReactI18next).init({
  resources: { en: { translation: en }, ta: { translation: ta }, hi: { translation: hi } },
  lng: 'en',
  fallbackLng: 'en',
  interpolation: { escapeValue: false },
})

export default i18n
