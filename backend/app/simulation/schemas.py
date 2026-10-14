from __future__ import annotations

from datetime import date
from enum import Enum
from typing import Annotated, Any, Literal

from pydantic import BaseModel, ConfigDict, Field, PositiveInt, StrictInt, StrictStr, model_validator


SCHEMA_VERSION = "simulation.contract.v1"
ENGINE_VERSION = "simulation-engine.v1.0.0"

MAX_HORIZON_DAYS = 730
MAX_EVENTS = 500
MAX_SAFE_INTEGER = 9_000_000_000_000_000
MAX_QUANTITY = 1_000_000_000_000


class StrictBaseModel(BaseModel):
    model_config = ConfigDict(extra="forbid", validate_assignment=True)


class EventType(str, Enum):
    CASH_RECEIPT = "CASH_RECEIPT"
    SUPPLIER_PAYMENT = "SUPPLIER_PAYMENT"
    INVENTORY_ARRIVAL = "INVENTORY_ARRIVAL"
    PRODUCTION_START = "PRODUCTION_START"
    PRODUCTION_COMPLETE = "PRODUCTION_COMPLETE"
    DELIVERY = "DELIVERY"
    OTHER_EXPENSE = "OTHER_EXPENSE"
    CREDIT_DRAWDOWN = "CREDIT_DRAWDOWN"
    CREDIT_REPAYMENT = "CREDIT_REPAYMENT"


class EventStatus(str, Enum):
    EXECUTED = "EXECUTED"
    RESOURCE_BLOCKED_AT_HORIZON = "RESOURCE_BLOCKED_AT_HORIZON"
    DEPENDENCY_BLOCKED_AT_HORIZON = "DEPENDENCY_BLOCKED_AT_HORIZON"
    NOT_YET_ELIGIBLE_WITHIN_HORIZON = "NOT_YET_ELIGIBLE_WITHIN_HORIZON"


class SchedulingPolicyName(str, Enum):
    GREEDY_DAILY = "GREEDY_DAILY"


class Dependency(StrictBaseModel):
    predecessor_event_id: StrictStr
    lag_days: StrictInt = Field(ge=0)


class InventoryQuantity(StrictBaseModel):
    material_id: StrictStr
    quantity: StrictInt = Field(gt=0, le=MAX_QUANTITY)
    unit: StrictStr = "unit"


class Order(StrictBaseModel):
    id: StrictStr
    customer_id: StrictStr
    promised_delivery_date: date
    material_requirements: list[InventoryQuantity]
    production_start_cost_paise: StrictInt = Field(ge=0, le=MAX_SAFE_INTEGER)
    production_duration_days: StrictInt = Field(ge=0, le=MAX_HORIZON_DAYS)
    priority: StrictInt = Field(ge=0, default=100)


class CreditFacility(StrictBaseModel):
    id: StrictStr
    approved_limit_paise: StrictInt = Field(gt=0, le=MAX_SAFE_INTEGER)
    available_from_date: date
    annual_interest_rate_bps: StrictInt = Field(ge=0, le=100_000)
    drawdown_fee_paise: StrictInt = Field(ge=0, le=MAX_SAFE_INTEGER)
    contractual_repayment_date: date
    assumptions: list[StrictStr] = Field(default_factory=list)


class Event(StrictBaseModel):
    id: StrictStr
    type: EventType
    order_id: StrictStr | None = None
    counterparty_id: StrictStr | None = None
    earliest_date: date
    due_date: date | None = None
    dependencies: list[Dependency] = Field(default_factory=list)
    priority: StrictInt = Field(ge=0, default=100)
    amount_paise: StrictInt | None = Field(default=None, gt=0, le=MAX_SAFE_INTEGER)
    inventory_quantities: list[InventoryQuantity] | None = None
    facility_id: StrictStr | None = None
    principal_paise: StrictInt | None = Field(default=None, gt=0, le=MAX_SAFE_INTEGER)
    assumptions: list[StrictStr] = Field(default_factory=list)

    @model_validator(mode="after")
    def validate_event_specific_fields(self) -> "Event":
        amount_types = {EventType.CASH_RECEIPT, EventType.SUPPLIER_PAYMENT, EventType.OTHER_EXPENSE}
        no_effect_types = {EventType.PRODUCTION_START, EventType.PRODUCTION_COMPLETE, EventType.DELIVERY}
        if self.type in amount_types:
            if self.amount_paise is None:
                raise ValueError(f"{self.type.value} requires amount_paise")
            if self.inventory_quantities is not None or self.facility_id is not None or self.principal_paise is not None:
                raise ValueError(f"{self.type.value} cannot carry inventory or financing fields")
        elif self.type == EventType.INVENTORY_ARRIVAL:
            if not self.inventory_quantities:
                raise ValueError("INVENTORY_ARRIVAL requires inventory_quantities")
            if self.amount_paise is not None or self.facility_id is not None or self.principal_paise is not None:
                raise ValueError("INVENTORY_ARRIVAL cannot carry cash or financing fields")
        elif self.type == EventType.CREDIT_DRAWDOWN:
            if self.facility_id is None or self.principal_paise is None:
                raise ValueError("CREDIT_DRAWDOWN requires facility_id and principal_paise")
            if self.amount_paise is not None or self.inventory_quantities is not None:
                raise ValueError("CREDIT_DRAWDOWN cannot carry ordinary cash or inventory fields")
        elif self.type == EventType.CREDIT_REPAYMENT:
            if self.facility_id is None:
                raise ValueError("CREDIT_REPAYMENT requires facility_id")
            if self.amount_paise is not None or self.inventory_quantities is not None or self.principal_paise is not None:
                raise ValueError("CREDIT_REPAYMENT amount is calculated from outstanding principal and interest")
        elif self.type in no_effect_types:
            if self.amount_paise is not None or self.inventory_quantities is not None or self.facility_id is not None or self.principal_paise is not None:
                raise ValueError(f"{self.type.value} cannot carry direct effect fields")
            if self.type in {EventType.PRODUCTION_START, EventType.PRODUCTION_COMPLETE, EventType.DELIVERY} and self.order_id is None:
                raise ValueError(f"{self.type.value} requires order_id")
        return self


class BusinessSnapshot(StrictBaseModel):
    schema_version: StrictStr = SCHEMA_VERSION
    business_id: StrictStr
    start_date: date
    horizon_days: StrictInt = Field(gt=0, le=MAX_HORIZON_DAYS)
    opening_cash_paise: StrictInt = Field(ge=0, le=MAX_SAFE_INTEGER)
    opening_inventory: list[InventoryQuantity] = Field(default_factory=list)
    orders: list[Order] = Field(default_factory=list)
    events: list[Event] = Field(default_factory=list, max_length=MAX_EVENTS)
    approved_credit_facilities: list[CreditFacility] = Field(default_factory=list)


class SchedulingPolicy(StrictBaseModel):
    name: SchedulingPolicyName = SchedulingPolicyName.GREEDY_DAILY
    description: StrictStr = (
        "Eligible resource-adding events execute first. Consuming events are then tried greedily "
        "by order priority, event priority, original due date, and stable event ID; infeasible events "
        "are skipped without implicit reservation."
    )


class MoveReceiptDate(StrictBaseModel):
    type: Literal["MOVE_RECEIPT_DATE"]
    event_id: StrictStr
    new_earliest_date: date
    new_due_date: date | None = None
    assumption: StrictStr | None = None


class DelayArrival(StrictBaseModel):
    type: Literal["DELAY_ARRIVAL"]
    event_id: StrictStr
    delay_days: StrictInt = Field(gt=0, le=MAX_HORIZON_DAYS)
    assumption: StrictStr | None = None


class SplitCustomerCollection(StrictBaseModel):
    type: Literal["SPLIT_CUSTOMER_COLLECTION"]
    event_id: StrictStr
    deposit_event_id: StrictStr
    deposit_amount_paise: StrictInt = Field(gt=0, le=MAX_SAFE_INTEGER)
    deposit_date: date
    customer_agreement_assumption: StrictStr


class SupplierInstalment(StrictBaseModel):
    id: StrictStr
    amount_paise: StrictInt = Field(gt=0, le=MAX_SAFE_INTEGER)
    earliest_date: date
    due_date: date | None = None


class SplitSupplierPayment(StrictBaseModel):
    type: Literal["SPLIT_SUPPLIER_PAYMENT"]
    event_id: StrictStr
    instalments: list[SupplierInstalment] = Field(min_length=2)
    release_policy: Literal["FULL_PAYMENT", "RELEASE_AFTER_FIRST_INSTALMENT"] = "FULL_PAYMENT"
    supplier_agreement_assumption: StrictStr


class AddCreditBridge(StrictBaseModel):
    type: Literal["ADD_CREDIT_BRIDGE"]
    facility: CreditFacility | None = None
    facility_id: StrictStr
    drawdown_event_id: StrictStr
    repayment_event_id: StrictStr
    principal_paise: StrictInt = Field(gt=0, le=MAX_SAFE_INTEGER)
    drawdown_date: date
    assumption: StrictStr


ScenarioChange = Annotated[
    MoveReceiptDate | DelayArrival | SplitCustomerCollection | SplitSupplierPayment | AddCreditBridge,
    Field(discriminator="type"),
]


class Scenario(StrictBaseModel):
    scenario_id: StrictStr
    assumptions: list[StrictStr] = Field(default_factory=list)
    changes: list[ScenarioChange] = Field(default_factory=list)


class BlockingReason(StrictBaseModel):
    code: StrictStr
    details: dict[str, Any]


class BlockingRecord(StrictBaseModel):
    day: StrictInt
    date: date
    reasons: list[BlockingReason]


class DailyBalance(StrictBaseModel):
    day: StrictInt
    date: date
    cash_paise: StrictInt
    inventory: list[InventoryQuantity]
    outstanding_debt_paise: StrictInt
    pending_event_count: StrictInt


class EventResult(StrictBaseModel):
    id: StrictStr
    type: EventType
    order_id: StrictStr | None = None
    original_due_date: date | None = None
    actual_execution_date: date | None = None
    status: EventStatus
    lateness_days: StrictInt | None = None
    blocking_history: list[BlockingRecord] = Field(default_factory=list)
    dependency_event_ids: list[StrictStr] = Field(default_factory=list)


class OrderResult(StrictBaseModel):
    order_id: StrictStr
    promised_delivery_date: date
    delivery_event_id: StrictStr | None = None
    delivery_date: date | None = None
    delivery_lateness_days: StrictInt | None = None
    status: StrictStr


class FinancingFacilitySummary(StrictBaseModel):
    facility_id: StrictStr
    drawdown_date: date | None = None
    repayment_date: date | None = None
    outstanding_principal_paise: StrictInt
    paid_interest_paise: StrictInt
    accrued_interest_paise: StrictInt
    overdue: bool
    contractual_repayment_date: date
    unresolved_obligation_paise: StrictInt


class FinancingSummary(StrictBaseModel):
    total_outstanding_principal_paise: StrictInt
    total_paid_interest_paise: StrictInt
    total_accrued_interest_paise: StrictInt
    overdue_financing_obligations: list[FinancingFacilitySummary]
    facilities: list[FinancingFacilitySummary]


class SimulationMetrics(StrictBaseModel):
    missed_commitment_count: StrictInt
    unresolved_order_count: StrictInt
    minimum_executable_cash_paise: StrictInt
    closing_cash_paise: StrictInt
    outstanding_debt_paise: StrictInt
    accrued_financing_cost_paise: StrictInt
    overdue_financing_obligation_count: StrictInt
    extra_funding_needed_to_preserve_target_schedule: Literal["UNSUPPORTED"] = "UNSUPPORTED"


class ExecutionLogEntry(StrictBaseModel):
    """One line of the engine's daily loop, in execution order (E-1)."""
    day: StrictInt
    date: date
    seq: StrictInt
    event_id: StrictStr
    type: EventType
    group: Literal["BRING_IN", "MOVE_GOODS", "PAY_OUT"]
    sort_key: list[Any]
    outcome: Literal["EXECUTED", "BLOCKED", "NOT_ELIGIBLE"]
    cash_before_paise: StrictInt
    cash_after_paise: StrictInt
    reasons: list[BlockingReason] = Field(default_factory=list)


class SimulationResult(StrictBaseModel):
    schema_version: StrictStr
    engine_version: StrictStr
    scenario_id: StrictStr
    scheduling_policy: SchedulingPolicy
    assumptions: list[StrictStr]
    daily_balances: list[DailyBalance]
    event_results: list[EventResult]
    order_results: list[OrderResult]
    missed_commitments: list[EventResult]
    unresolved_events: list[EventResult]
    financing_summary: FinancingSummary
    metrics: SimulationMetrics
    comparison_metrics: dict[str, Any] | None = None
    transaction_totals: dict[str, StrictInt]
    execution_log: list[ExecutionLogEntry] | None = None


class ComparisonRequest(StrictBaseModel):
    snapshot: BusinessSnapshot
    scenario: Scenario
    policy: SchedulingPolicy = Field(default_factory=SchedulingPolicy)


class SimulationRequest(StrictBaseModel):
    snapshot: BusinessSnapshot
    scenario: Scenario | None = None
    policy: SchedulingPolicy = Field(default_factory=SchedulingPolicy)
    include_execution_log: bool = False


class ComparisonResult(StrictBaseModel):
    schema_version: StrictStr
    engine_version: StrictStr
    baseline: SimulationResult
    scenario: SimulationResult
    comparison_metrics: dict[str, Any]
