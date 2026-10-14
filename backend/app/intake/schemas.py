from __future__ import annotations

from datetime import date
from enum import Enum

from pydantic import BaseModel, ConfigDict, Field, StrictInt, StrictStr


class IntakeModel(BaseModel):
    model_config = ConfigDict(extra="forbid", validate_assignment=True)


class CollectionStatus(str, Enum):
    UNKNOWN = "UNKNOWN"
    CONFIRMED_COMPLETE = "CONFIRMED_COMPLETE"


class FactStatus(str, Enum):
    EXTRACTED = "EXTRACTED"
    USER_CONFIRMED = "USER_CONFIRMED"
    UNKNOWN = "UNKNOWN"


class ReleaseCondition(str, Enum):
    INDEPENDENT = "INDEPENDENT"
    FULL_PAYMENT = "FULL_PAYMENT"
    OTHER = "OTHER"


class CollectionTimingType(str, Enum):
    FIXED_DATE = "FIXED_DATE"
    DAYS_AFTER_DELIVERY = "DAYS_AFTER_DELIVERY"


class Evidence(IntakeModel):
    fact_reference: StrictStr
    field_path: StrictStr
    source_excerpt: StrictStr
    status: FactStatus


class Money(IntakeModel):
    amount: StrictStr
    currency: StrictStr = "INR"
    unit: StrictStr = "rupees"


class InventoryFact(IntakeModel):
    material_reference: StrictStr | None = None
    material_name: StrictStr | None = None
    quantity: StrictInt | None = Field(default=None, gt=0)
    unit: StrictStr | None = None


class SupplierPurchaseFact(IntakeModel):
    source_reference: StrictStr | None = None
    supplier: StrictStr | None = None
    materials: list[InventoryFact] = Field(default_factory=list)
    outstanding_payment: Money | None = None
    earliest_payment_date: date | None = None
    contractual_due_date: date | None = None
    release_condition: ReleaseCondition | None = None
    arrival_date: date | None = None
    lead_time_days: StrictInt | None = Field(default=None, ge=0)
    already_paid: bool = False


class CustomerOrderFact(IntakeModel):
    source_reference: StrictStr | None = None
    order_reference: StrictStr | None = None
    customer: StrictStr | None = None
    materials: list[InventoryFact] = Field(default_factory=list)
    production_start_cost: Money | None = None
    production_duration_days: StrictInt | None = Field(default=None, ge=0)
    earliest_production_start_date: date | None = None
    promised_delivery_date: date | None = None
    outstanding_collection: Money | None = None
    collection_timing_type: CollectionTimingType | None = None
    collection_date: date | None = None
    collection_days_after_delivery: StrictInt | None = Field(default=None, ge=0)
    already_collected: bool = False
    priority: StrictInt = Field(default=100, ge=0)


class ReceivableFact(IntakeModel):
    source_reference: StrictStr | None = None
    customer: StrictStr | None = None
    amount: Money | None = None
    expected_collection_date: date | None = None
    already_collected: bool = False


class ExpenseFact(IntakeModel):
    source_reference: StrictStr | None = None
    description: StrictStr | None = None
    amount: Money | None = None
    due_date: date | None = None


class ApprovedFacilityFact(IntakeModel):
    source_reference: StrictStr | None = None
    facility_id: StrictStr | None = None
    approved: bool = False
    approved_limit: Money | None = None
    available_from_date: date | None = None
    annual_interest_rate_bps: StrictInt | None = Field(default=None, ge=0)
    drawdown_fee: Money | None = None
    contractual_repayment_date: date | None = None


class BusinessFacts(IntakeModel):
    business_name: StrictStr | None = None
    opening_cash: Money | None = None
    opening_inventory: list[InventoryFact] = Field(default_factory=list)
    inventory_status: CollectionStatus | None = CollectionStatus.UNKNOWN
    supplier_purchases: list[SupplierPurchaseFact] = Field(default_factory=list)
    supplier_purchases_status: CollectionStatus | None = CollectionStatus.UNKNOWN
    customer_orders: list[CustomerOrderFact] = Field(default_factory=list)
    customer_orders_status: CollectionStatus | None = CollectionStatus.UNKNOWN
    existing_receivables: list[ReceivableFact] = Field(default_factory=list)
    existing_receivables_status: CollectionStatus | None = CollectionStatus.UNKNOWN
    expenses: list[ExpenseFact] = Field(default_factory=list)
    approved_facilities: list[ApprovedFacilityFact] = Field(default_factory=list)
    facilities_status: CollectionStatus | None = CollectionStatus.UNKNOWN
    evidence: list[Evidence] = Field(default_factory=list)
    unresolved_questions: list[StrictStr] = Field(default_factory=list)


class IntakeRequest(IntakeModel):
    business_id: StrictStr
    start_date: date
    horizon_days: StrictInt = Field(gt=0, le=730)
    source_text: StrictStr = Field(min_length=1)
    reviewed_facts: BusinessFacts | None = None


class DraftCorrection(IntakeModel):
    facts: BusinessFacts


class ApprovalRequest(IntakeModel):
    draft_id: StrictStr
    draft_version: StrictInt = Field(gt=0)
    approval: StrictStr


class DraftResponse(IntakeModel):
    draft_id: StrictStr
    draft_version: StrictInt
    status: StrictStr
    extracted_facts: BusinessFacts
    evidence: list[Evidence]
    unresolved_questions: list[StrictStr]
    validation_issues: list[StrictStr]
    draft_snapshot: dict | None = None
