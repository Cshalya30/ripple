"""Message drafting from fixed templates (PRD 12.6). Amounts and dates are filled from
records; the language model is never used here. Ripple never sends anything: it builds
a wa.me click-to-chat link the owner opens.

Tamil and Hindi templates must be reviewed by a fluent speaker before real use.
"""
from __future__ import annotations

import re
from datetime import date
from typing import Any
from urllib.parse import quote

MONTHS = {
    "en": ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"],
    "ta": ["ஜனவரி", "பிப்ரவரி", "மார்ச்", "ஏப்ரல்", "மே", "ஜூன்", "ஜூலை", "ஆகஸ்ட்", "செப்டம்பர்", "அக்டோபர்", "நவம்பர்", "டிசம்பர்"],
    "hi": ["जनवरी", "फ़रवरी", "मार्च", "अप्रैल", "मई", "जून", "जुलाई", "अगस्त", "सितंबर", "अक्टूबर", "नवंबर", "दिसंबर"],
}

INTRO = {
    "en": "Namaste {party}, this is {owner} from {business}.",
    "ta": "வணக்கம் {party}, நான் {business} நிறுவனத்திலிருந்து {owner}.",
    "hi": "नमस्ते {party}, {business} की ओर से {owner} का संदेश।",
}

TEMPLATES: dict[str, dict[str, dict[str, str]]] = {
    "reminder_overdue": {
        "en": {
            "polite": "{intro} A gentle reminder that invoice {invoice} for {amount} was due on {due_date}. Could you please arrange the payment this week? Thank you.",
            "firm": "Dear {party}, invoice {invoice} for {amount} was due on {due_date} and is now {days_late} days overdue. Please clear the payment by {pay_by}. Regards, {owner}, {business}.",
        },
        "ta": {
            "polite": "{intro} {due_date} அன்று செலுத்த வேண்டிய பில் {invoice}, தொகை {amount}, இன்னும் நிலுவையில் உள்ளது. இந்த வாரத்திற்குள் செலுத்த ஏற்பாடு செய்ய முடியுமா? நன்றி.",
            "firm": "அன்புள்ள {party}, பில் {invoice}, தொகை {amount}, {due_date} அன்று செலுத்த வேண்டியது. இப்போது {days_late} நாட்கள் தாமதமாகிவிட்டது. தயவுசெய்து {pay_by}க்குள் செலுத்தவும். {owner}, {business}.",
        },
        "hi": {
            "polite": "{intro} बिल {invoice} ({amount}) की भुगतान तिथि {due_date} थी। कृपया इस सप्ताह भुगतान की व्यवस्था कर दें। धन्यवाद।",
            "firm": "प्रिय {party}, बिल {invoice} ({amount}) की भुगतान तिथि {due_date} थी और अब {days_late} दिन बीत चुके हैं। कृपया {pay_by} तक भुगतान कर दें। {owner}, {business}",
        },
    },
    "reminder_upcoming": {
        "en": {
            "polite": "{intro} A friendly reminder that invoice {invoice} for {amount} is due on {due_date}. Thank you.",
            "firm": "Dear {party}, invoice {invoice} for {amount} is due on {due_date}. Please make sure it is paid on time. Regards, {owner}, {business}.",
        },
        "ta": {
            "polite": "{intro} பில் {invoice}, தொகை {amount}, {due_date} அன்று செலுத்த வேண்டியது என்பதை நினைவூட்டுகிறோம். நன்றி.",
            "firm": "அன்புள்ள {party}, பில் {invoice}, தொகை {amount}, {due_date} அன்று செலுத்த வேண்டும். குறித்த நேரத்தில் செலுத்தவும். {owner}, {business}.",
        },
        "hi": {
            "polite": "{intro} याद दिलाना था कि बिल {invoice} ({amount}) की भुगतान तिथि {due_date} है। धन्यवाद।",
            "firm": "प्रिय {party}, बिल {invoice} ({amount}) की भुगतान तिथि {due_date} है। कृपया समय पर भुगतान करें। {owner}, {business}",
        },
    },
    "early_discount": {
        "en": {
            "polite": "{intro} If you can clear invoice {invoice} ({amount}) by {pay_by}, you only need to pay {discounted}, a discount of {discount}. Please let me know if this works for you.",
            "firm": "{intro} Offer for invoice {invoice} ({amount}): pay {discounted} by {pay_by} and keep {discount} as a discount. The offer is valid until {pay_by}.",
        },
        "ta": {
            "polite": "{intro} பில் {invoice} ({amount}) தொகையை {pay_by}க்குள் செலுத்தினால், {discount} தள்ளுபடியுடன் {discounted} மட்டும் செலுத்தினால் போதும். உங்களுக்குச் சரியா என்று தெரிவிக்கவும்.",
            "firm": "{intro} பில் {invoice} ({amount}): {pay_by}க்குள் {discounted} செலுத்தினால் {discount} தள்ளுபடி. இந்தச் சலுகை {pay_by} வரை மட்டுமே.",
        },
        "hi": {
            "polite": "{intro} अगर आप बिल {invoice} ({amount}) का भुगतान {pay_by} तक कर दें, तो {discount} की छूट के साथ केवल {discounted} देना होगा। कृपया बताएं कि क्या यह ठीक है।",
            "firm": "{intro} बिल {invoice} ({amount}): {pay_by} तक {discounted} दें और {discount} की छूट पाएं। यह प्रस्ताव केवल {pay_by} तक है।",
        },
    },
    "extension": {
        "en": {
            "polite": "{intro} Our payment of {amount} for {invoice} is due on {due_date}. A customer payment we were counting on is delayed. Could you allow us until {new_date}? We will pay in full on that date. Thank you for your support.",
            "firm": "{intro} We request an extension for {invoice} ({amount}) from {due_date} to {new_date}, and confirm full payment on {new_date}.",
        },
        "ta": {
            "polite": "{intro} {invoice}க்கான {amount} தொகை {due_date} அன்று செலுத்த வேண்டும். எங்களுக்கு வர வேண்டிய ஒரு வாடிக்கையாளர் பணம் தாமதமாகியுள்ளது. {new_date} வரை அவகாசம் தர முடியுமா? அன்று முழுத் தொகையையும் செலுத்திவிடுவோம். உங்கள் ஆதரவுக்கு நன்றி.",
            "firm": "{intro} {invoice} ({amount}) செலுத்தும் தேதியை {due_date} இலிருந்து {new_date} க்கு மாற்ற வேண்டுகிறோம். {new_date} அன்று முழுத் தொகையும் செலுத்தப்படும்.",
        },
        "hi": {
            "polite": "{intro} {invoice} के लिए {amount} का भुगतान {due_date} को देय है। एक ग्राहक से आने वाला भुगतान देर से आ रहा है। क्या आप हमें {new_date} तक का समय दे सकते हैं? उस दिन हम पूरा भुगतान कर देंगे। आपके सहयोग के लिए धन्यवाद।",
            "firm": "{intro} {invoice} ({amount}) की भुगतान तिथि {due_date} से {new_date} करने का अनुरोध है। {new_date} को पूरा भुगतान कर दिया जाएगा।",
        },
    },
    "instalment": {
        "en": {
            "polite": "{intro} Our payment of {amount} for {invoice} is due on {due_date}. We would like to pay {first_amount} on {due_date} and the balance of {second_amount} on {second_date}. Could you dispatch the next lot after the first payment? Thank you.",
            "firm": "{intro} For {invoice} ({amount}) we will pay {first_amount} on {due_date} and {second_amount} on {second_date}. Please dispatch the next lot after the first payment.",
        },
        "ta": {
            "polite": "{intro} {invoice}க்கான {amount} தொகை {due_date} அன்று செலுத்த வேண்டும். {due_date} அன்று {first_amount}, மீதி {second_amount} {second_date} அன்று செலுத்த விரும்புகிறோம். முதல் தவணைக்குப் பிறகு அடுத்த சரக்கை அனுப்ப முடியுமா? நன்றி.",
            "firm": "{intro} {invoice} ({amount}): {due_date} அன்று {first_amount}, {second_date} அன்று {second_amount} செலுத்துவோம். முதல் தவணைக்குப் பிறகு அடுத்த சரக்கை அனுப்பவும்.",
        },
        "hi": {
            "polite": "{intro} {invoice} के लिए {amount} का भुगतान {due_date} को देय है। हम {due_date} को {first_amount} और बाकी {second_amount} {second_date} को देना चाहते हैं। क्या आप पहली किस्त के बाद अगला माल भेज सकते हैं? धन्यवाद।",
            "firm": "{intro} {invoice} ({amount}) के लिए हम {due_date} को {first_amount} और {second_date} को {second_amount} देंगे। कृपया पहली किस्त के बाद अगला माल भेजें।",
        },
    },
    "deposit": {
        "en": {
            "polite": "{intro} For order {order} ({amount}), could you pay an advance of {deposit} by {pay_by}? The balance stays on the usual terms after delivery. This helps us buy material on time for your order.",
            "firm": "{intro} To start order {order} ({amount}) on time we need an advance of {deposit} by {pay_by}. The balance is due on the usual terms after delivery.",
        },
        "ta": {
            "polite": "{intro} ஆர்டர் {order} ({amount}) க்காக, {pay_by}க்குள் {deposit} முன்பணம் செலுத்த முடியுமா? மீதித் தொகை டெலிவரிக்குப் பிறகு வழக்கமான முறையில். இது உங்கள் ஆர்டருக்கான மூலப்பொருட்களை நேரத்தில் வாங்க உதவும்.",
            "firm": "{intro} ஆர்டர் {order} ({amount}) நேரத்தில் தொடங்க, {pay_by}க்குள் {deposit} முன்பணம் தேவை. மீதித் தொகை டெலிவரிக்குப் பிறகு வழக்கமான முறையில்.",
        },
        "hi": {
            "polite": "{intro} ऑर्डर {order} ({amount}) के लिए, क्या आप {pay_by} तक {deposit} अग्रिम दे सकते हैं? बाकी राशि डिलीवरी के बाद सामान्य शर्तों पर। इससे हम आपके ऑर्डर के लिए सामग्री समय पर खरीद सकेंगे।",
            "firm": "{intro} ऑर्डर {order} ({amount}) समय पर शुरू करने के लिए {pay_by} तक {deposit} अग्रिम चाहिए। बाकी राशि डिलीवरी के बाद सामान्य शर्तों पर।",
        },
    },
}

MSME_LINE = {
    "en": "As per Section 15 of the MSMED Act, 2006, payment to a registered micro or small enterprise is due within 45 days. Our Udyam registration: {udyam}.",
    "ta": "MSMED சட்டம் 2006, பிரிவு 15-இன்படி, பதிவு செய்யப்பட்ட குறு அல்லது சிறு நிறுவனத்திற்கான பணம் 45 நாட்களுக்குள் செலுத்தப்பட வேண்டும். எங்கள் உத்யம் பதிவு: {udyam}.",
    "hi": "MSMED अधिनियम, 2006 की धारा 15 के अनुसार, पंजीकृत सूक्ष्म या लघु उद्यम को भुगतान 45 दिनों के भीतर देय है। हमारा उद्यम पंजीकरण: {udyam}।",
}

INTENTS = {"reminder", "early_discount", "extension", "instalment", "deposit"}
CUSTOMER_INTENTS = {"reminder", "early_discount", "deposit"}


def rupees(paise: int) -> str:
    """₹1,45,000 with Indian grouping and Western digits; paise shown only when present."""
    negative = paise < 0
    paise = abs(paise)
    rupee, fraction = divmod(paise, 100)
    text = str(rupee)
    if len(text) > 3:
        head, tail = text[:-3], text[-3:]
        groups = []
        while len(head) > 2:
            groups.insert(0, head[-2:])
            head = head[:-2]
        if head:
            groups.insert(0, head)
        text = ",".join(groups) + "," + tail
    body = f"₹{text}" + (f".{fraction:02d}" if fraction else "")
    return f"−{body}" if negative else body


def human_date(value: date | str, lang: str = "en") -> str:
    day = date.fromisoformat(value) if isinstance(value, str) else value
    return f"{day.day} {MONTHS.get(lang, MONTHS['en'])[day.month - 1]}"


def render(intent_key: str, tone: str, lang: str, slots: dict[str, str], msme: dict[str, Any] | None) -> str:
    lang = lang if lang in INTRO else "en"
    tone = tone if tone in ("polite", "firm") else "polite"
    template = TEMPLATES[intent_key][lang][tone]
    values = {**slots}
    values["intro"] = INTRO[lang].format(**values)
    text = template.format(**values)
    if msme:
        text += " " + MSME_LINE[lang].format(udyam=msme["udyam"])
    return re.sub(r"\s+", " ", text).strip()


def wa_link(phone: str | None, text: str) -> str | None:
    digits = re.sub(r"\D", "", phone or "")
    if not digits:
        return None
    return f"https://wa.me/{digits}?text={quote(text)}"
