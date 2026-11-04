document.documentElement.classList.add('js');
const shell = document.querySelector('.product-shell');
const viewButtons = [...document.querySelectorAll('.view-switch button')];
const panes = ['plan', 'architecture', 'workflow', 'preview'];
const descriptions = {
  plan: 'Start with a goal. Review the plan before the build.',
  architecture: 'See the components and how they connect.',
  workflow: 'Follow the work. Inspect each step. Guide the next move.',
  preview: 'Try a counter inspired by the verified Mulow demo.'
};
function selectView(view) {
  shell.dataset.view = view;
  viewButtons.forEach(button => button.setAttribute('aria-pressed', String(button.dataset.view === view)));
  panes.forEach(name => { document.querySelector(`.${name}-pane`).hidden = name !== view; });
  document.querySelector('#view-description').textContent = descriptions[view];
}
viewButtons.forEach(button => button.addEventListener('click', () => selectView(button.dataset.view)));

const motionButton = document.querySelector('.motion-toggle');
motionButton.addEventListener('click', () => {
  const paused = document.documentElement.classList.toggle('motion-paused');
  motionButton.setAttribute('aria-pressed', String(paused));
  motionButton.innerHTML = paused ? 'Resume motion <span aria-hidden="true">▷</span>' : 'Pause motion <span aria-hidden="true">Ⅱ</span>';
});

let count = 0;
function showCount() {
  document.querySelector('#count').textContent = String(count);
  document.querySelector('#parity').textContent = count % 2 === 0 ? 'Even' : 'Odd';
}
document.querySelectorAll('[data-add]').forEach(button => button.addEventListener('click', () => {
  count += Number(button.dataset.add);
  showCount();
}));
document.querySelector('.reset-counter').addEventListener('click', () => { count = 0; showCount(); });

let steerTimeout;
document.querySelector('.steer-button').addEventListener('click', () => {
  clearTimeout(steerTimeout);
  shell.classList.add('is-steering');
  document.querySelector('#canvas-status').textContent = 'Your direction. The same project.';
  document.querySelector('.node-build strong').textContent = 'Add 10 + parity';
  document.querySelector('.steer-card strong').textContent = 'A new direction.';
  steerTimeout = setTimeout(() => { shell.classList.remove('is-steering'); }, 2400);
});

if ('IntersectionObserver' in window) {
  const observer = new IntersectionObserver(entries => {
    entries.forEach(entry => { if (entry.isIntersecting) { entry.target.classList.add('visible'); observer.unobserve(entry.target); } });
  }, { threshold: 0.12 });
  document.querySelectorAll('.reveal').forEach(element => observer.observe(element));
} else {
  document.querySelectorAll('.reveal').forEach(element => element.classList.add('visible'));
}
