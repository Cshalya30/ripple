import re
p = "C:/ripple/backend/app/services/fixes.py"
s = open(p, encoding="utf8").read()
a = s.index("def _rupees(paise: int) -> str:")
s = s[:a] + '''def _rupees(paise: int) -> str:
    """One formatter for money in server-written text: exact paise, Indian grouping, a real minus sign for losses."""
    return rupees(int(paise))
'''
s = s.replace("from .position import round_up", "from .messages import rupees\nfrom .position import round_up", 1)
open(p, "w", encoding="utf8").write(s)

p = "C:/ripple/backend/app/services/guard.py"
s = open(p, encoding="utf8").read()
a = s.index("def rs(paise: int) -> str:")
b = s.index("def _floor_k")
s = s[:a] + '''def rs(paise: int) -> str:
    """Rupees in server-written text (the shared formatter: exact paise, Indian grouping, a real minus sign)."""
    return rupees(int(paise))


''' + s[b:]
s = s.replace("from .fixes import _human, _rupees\n", "from .fixes import _human\n", 1)
s = s.replace("from .inventory import inventory_rows\n", "from .inventory import inventory_rows\nfrom .messages import rupees\n", 1)
open(p, "w", encoding="utf8").write(s)
print("ok")
