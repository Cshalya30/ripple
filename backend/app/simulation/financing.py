from __future__ import annotations

from dataclasses import dataclass

from .schemas import CreditFacility


@dataclass
class DebtState:
    facility: CreditFacility
    principal_paise: int = 0
    draw_day: int | None = None
    repayment_day: int | None = None
    paid_interest_paise: int = 0


def ceil_div(numerator: int, denominator: int) -> int:
    return -(-numerator // denominator)


def accrued_interest_paise(principal_paise: int, annual_interest_rate_bps: int, elapsed_days: int) -> int:
    if principal_paise <= 0 or annual_interest_rate_bps <= 0 or elapsed_days <= 0:
        return 0
    return ceil_div(principal_paise * annual_interest_rate_bps * elapsed_days, 365 * 10_000)


def payable_interest_for_day(debt: DebtState, day: int) -> int:
    if debt.draw_day is None or debt.principal_paise <= 0:
        return 0
    return accrued_interest_paise(
        debt.principal_paise,
        debt.facility.annual_interest_rate_bps,
        day - debt.draw_day,
    )
