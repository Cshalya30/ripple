export interface SampleRow {
  party: string
  type: 'Customer' | 'Supplier'
  phone: string
  item: string
  qty: number
  bill: number
  settled: number
  billedDaysAgo: number
  dueIn: number
  place: string
}

export const FILE_COLUMNS = ['Party name', 'Type', 'Phone', 'Item', 'Qty', 'Bill amount', 'Received / Paid', 'Bill date', 'Due date'] as const

export const FIELD_OPTIONS = [
  'Name',
  'Customer or Supplier',
  'Phone',
  'Product',
  'Quantity',
  'Total amount',
  'Amount paid',
  'Sale or supply date',
  'Payment due date',
  'Skip this column',
] as const

export const DEFAULT_MAPPING: Record<string, (typeof FIELD_OPTIONS)[number]> = {
  'Party name': 'Name',
  Type: 'Customer or Supplier',
  Phone: 'Phone',
  Item: 'Product',
  Qty: 'Quantity',
  'Bill amount': 'Total amount',
  'Received / Paid': 'Amount paid',
  'Bill date': 'Sale or supply date',
  'Due date': 'Payment due date',
}

const customerNames: [string, string, string][] = [
  ['Lakshmi Silks', 'Salem', 'Kanchi silk sarees'],
  ['Nandini Fashions', 'Mangaluru', 'Rayon prints'],
  ['Patil Cloth Stores', 'Kolhapur', 'Cotton shirting'],
  ['Bombay Drapers', 'Mumbai', 'Suiting fabric'],
  ['Shree Ganesh Textiles', 'Nagpur', 'Cotton sarees'],
  ['Zoya Boutique', 'Lucknow', 'Chikankari fabric'],
  ['Chennai Silk House', 'Chennai', 'Soft silk'],
  ['Deepa Collections', 'Vijayawada', 'Designer blouse pieces'],
  ['Royal Fabrics', 'Indore', 'Poly-cotton'],
  ['Sai Krupa Textiles', 'Belagavi', 'Handloom cotton'],
  ['Kiran Garments', 'Surat', 'Crepe fabric'],
  ['Trendz Boutique', 'Coimbatore', 'Kurta fabric'],
  ['Aditi Sarees', 'Nashik', 'Paithani-style sarees'],
  ['Mahesh Cloth Centre', 'Kozhikode', 'Mull cotton'],
]

const supplierNames: [string, string, string][] = [
  ['Amar Cotton Traders', 'Rajkot', 'Raw cotton yarn'],
  ['Southern Dye Chem', 'Erode', 'Dye chemicals'],
  ['Krishna Weaving Co.', 'Bhiwandi', 'Grey fabric'],
  ['Om Sai Logistics', 'Pune', 'Freight'],
  ['National Buttons and Trims', 'Delhi', 'Buttons and laces'],
  ['Vijay Looms', 'Surat', 'Woven fabric'],
  ['Ravi Calendering Works', 'Karur', 'Calendering'],
  ['Shakti Labels', 'Ludhiana', 'Labels and tags'],
  ['Tamil Nadu Fibre Mart', 'Tiruppur', 'Viscose fibre'],
  ['Mohan Packers', 'Bengaluru', 'Packing material'],
]

export const sampleRows: SampleRow[] = [
  ...customerNames.map(([party, place, item], i): SampleRow => {
    const bill = 60000 + ((i * 37) % 11) * 12500
    return {
      party,
      type: 'Customer',
      phone: `+91 97000 10${String(i).padStart(3, '0')}`,
      item,
      qty: 40 + ((i * 29) % 13) * 15,
      bill,
      settled: Math.round((bill * (0.2 + ((i * 7) % 6) / 10)) / 1000) * 1000,
      billedDaysAgo: 4 + ((i * 5) % 28),
      dueIn: 3 + ((i * 11) % 60),
      place,
    }
  }),
  ...supplierNames.map(([party, place, item], i): SampleRow => {
    const bill = 45000 + ((i * 41) % 9) * 21000
    return {
      party,
      type: 'Supplier',
      phone: `+91 97000 20${String(i).padStart(3, '0')}`,
      item,
      qty: 30 + ((i * 23) % 11) * 40,
      bill,
      settled: Math.round((bill * (0.3 + ((i * 3) % 5) / 10)) / 1000) * 1000,
      billedDaysAgo: 3 + ((i * 7) % 24),
      dueIn: 5 + ((i * 13) % 55),
      place,
    }
  }),
]

export const TEMPLATE_CSV = [
  'Party name,Type,Phone,Item,Qty,Bill amount,Received / Paid,Bill date,Due date',
  'Kaveri Boutique,Customer,+91 98000 00201,Silk sarees,140,325000,180000,2026-09-01,2026-10-20',
  'Sharma Yarn Mills,Supplier,+91 98000 00101,Cotton yarn 40s,1850,640000,288000,2026-09-23,2026-11-17',
].join('\n')
