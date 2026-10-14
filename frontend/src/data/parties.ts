import type { Party } from '../types'
import { isoFromOffset } from '../lib/dates'

interface Seed {
  id: string
  kind: Party['kind']
  name: string
  phone: string
  details: string
  products: string[]
  quantity: number
  total: number
  paid: number
  soldDaysAgo: number
  dueIn: number
  causesShortfall?: boolean
}

const seeds: Seed[] = [
  // ───────── Suppliers
  { id: 'sup-sharma', kind: 'supplier', name: 'Sharma Yarn Mills', phone: '+91 98000 00101', details: 'Spinning mill, Ludhiana', products: ['Cotton yarn 40s', 'Polyester blend yarn'], quantity: 1850, total: 640000, paid: 288000, soldDaysAgo: 21, dueIn: 34, causesShortfall: true },
  { id: 'sup-bhavani', kind: 'supplier', name: 'Bhavani Dyeing Works', phone: '+91 98000 00102', details: 'Dyeing unit, Tiruppur', products: ['Reactive dyeing', 'Fabric washing'], quantity: 920, total: 210000, paid: 115000, soldDaysAgo: 14, dueIn: 6 },
  { id: 'sup-gopal', kind: 'supplier', name: 'Gopal Cotton Spinners', phone: '+91 98000 00103', details: 'Yarn mill, Coimbatore', products: ['Combed cotton yarn', 'Hosiery yarn'], quantity: 1200, total: 380000, paid: 220000, soldDaysAgo: 18, dueIn: 18 },
  { id: 'sup-rajdhani', kind: 'supplier', name: 'Rajdhani Roadlines', phone: '+91 98000 00104', details: 'Freight and transport, Delhi', products: ['Inter-state freight'], quantity: 36, total: 96000, paid: 58000, soldDaysAgo: 9, dueIn: 3 },
  { id: 'sup-lakshmi', kind: 'supplier', name: 'Lakshmi Silk Threads', phone: '+91 98000 00105', details: 'Thread merchant, Kanchipuram', products: ['Zari thread', 'Silk thread'], quantity: 310, total: 120000, paid: 80000, soldDaysAgo: 25, dueIn: 52 },
  { id: 'sup-patel', kind: 'supplier', name: 'Patel Packaging', phone: '+91 98000 00106', details: 'Packaging supplier, Ahmedabad', products: ['Poly bags', 'Cartons'], quantity: 2400, total: 54000, paid: 30000, soldDaysAgo: 6, dueIn: 71 },
  // ───────── Customers
  { id: 'cus-kaveri', kind: 'customer', name: 'Kaveri Boutique', phone: '+91 98000 00201', details: 'Saree boutique, Mysuru', products: ['Silk sarees', 'Dress material'], quantity: 140, total: 325000, paid: 180000, soldDaysAgo: 42, dueIn: -12, causesShortfall: true },
  { id: 'cus-anand', kind: 'customer', name: 'Anand Silk Emporium', phone: '+91 98000 00202', details: 'Retail shop, Bengaluru', products: ['Kanjivaram silk', 'Blouse pieces'], quantity: 95, total: 240000, paid: 155000, soldDaysAgo: 20, dueIn: 5 },
  { id: 'cus-mehta', kind: 'customer', name: 'Mehta Cloth House', phone: '+91 98000 00203', details: 'Cloth merchant, Pune', products: ['Cotton suiting', 'Shirting'], quantity: 410, total: 188000, paid: 126000, soldDaysAgo: 16, dueIn: 14 },
  { id: 'cus-venkateswara', kind: 'customer', name: 'Sri Venkateswara Textiles', phone: '+91 98000 00204', details: 'Wholesale shop, Hyderabad', products: ['Cotton sarees', 'Dhotis'], quantity: 260, total: 310000, paid: 190000, soldDaysAgo: 24, dueIn: 22 },
  { id: 'cus-meenakshi', kind: 'customer', name: 'Meenakshi Sarees', phone: '+91 98000 00205', details: 'Saree showroom, Madurai', products: ['Soft silk sarees'], quantity: 88, total: 215000, paid: 137000, soldDaysAgo: 19, dueIn: 27 },
  { id: 'cus-fashion', kind: 'customer', name: 'Fashion Junction', phone: '+91 98000 00206', details: 'Garment store, Kochi', products: ['Kurta fabric', 'Linen blends'], quantity: 300, total: 205000, paid: 115000, soldDaysAgo: 11, dueIn: 45 },
  { id: 'cus-rohini', kind: 'customer', name: 'Rohini Boutique', phone: '+91 98000 00207', details: 'Boutique, Hubballi', products: ['Georgette', 'Chiffon'], quantity: 175, total: 168000, paid: 72000, soldDaysAgo: 8, dueIn: 58 },
  { id: 'cus-gupta', kind: 'customer', name: 'Gupta Garments', phone: '+91 98000 00208', details: 'Garment wholesaler, Jaipur', products: ['Block-print cotton', 'Rayon'], quantity: 520, total: 260000, paid: 150000, soldDaysAgo: 5, dueIn: 74 },
]

export const mockParties: Party[] = seeds.map((s) => ({
  id: s.id,
  kind: s.kind,
  name: s.name,
  phone: s.phone,
  details: s.details,
  products: s.products,
  quantity: s.quantity,
  totalAmount: s.total,
  paidAmount: s.paid,
  owedAmount: s.total - s.paid,
  transactionDate: isoFromOffset(-s.soldDaysAgo),
  dueDate: isoFromOffset(s.dueIn),
  causesShortfall: s.causesShortfall,
}))

export const BUSINESS = {
  name: 'Mahalakshmi Fabrics',
  owner: 'Ramesh Agarwal',
  city: 'Bengaluru',
  cashToday: 230000,
  safetyBuffer: 50000,
}
