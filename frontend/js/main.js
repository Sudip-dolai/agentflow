// AgentFlow — Main JS
function toggleMenu() {
  const menu = document.getElementById('mobileMenu');
  if (menu) menu.classList.toggle('open');
}
window.addEventListener('load', () => {
  document.querySelectorAll('.bar-fill').forEach(bar => {
    const w = bar.style.width; bar.style.width = '0';
    setTimeout(() => { bar.style.width = w; }, 400);
  });
});
document.addEventListener('DOMContentLoaded', () => {
  document.querySelectorAll('a[href^="#"]').forEach(a => {
    a.addEventListener('click', e => {
      const target = document.querySelector(a.getAttribute('href'));
      if (target) { e.preventDefault(); target.scrollIntoView({ behavior: 'smooth' }); }
    });
  });
});
