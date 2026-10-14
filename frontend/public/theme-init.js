try {
  var t = localStorage.getItem('ripple-theme')
  if (t === 'night' || t === 'day' || t === 'lamp') document.documentElement.setAttribute('data-theme', t)
} catch (e) {}
