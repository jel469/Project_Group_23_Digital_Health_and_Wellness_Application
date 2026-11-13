const userStorageKey = 'wellness-user';

const ensureLoggedIn = () => {
  const user = JSON.parse(localStorage.getItem(userStorageKey) || 'null');
  if (!user && window.location.pathname !== '/login') {
    window.location.href = '/login';
    return null;
  }
  return user;
};

const showMessage = (element, text, type = '') => {
  if (!element) return;
  element.textContent = text;
  element.className = `message ${type}`.trim();
};

const request = async (url, options = {}) => {
  const response = await fetch(url, {
    headers: { 'Content-Type': 'application/json' },
    ...options,
  });

  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(data.message || 'Request failed.');
  }

  return data;
};

const initLoginPage = () => {
  const tabs = document.querySelectorAll('.tab');
  const forms = {
    login: document.getElementById('login-form'),
    signup: document.getElementById('signup-form'),
  };

  tabs.forEach((tab) => {
    tab.addEventListener('click', () => {
      const target = tab.dataset.tab;
      tabs.forEach((item) => item.classList.toggle('active', item === tab));
      forms.login.classList.toggle('active', target === 'login');
      forms.signup.classList.toggle('active', target === 'signup');
    });
  });

  forms.login?.addEventListener('submit', async (event) => {
    event.preventDefault();
    const message = document.getElementById('auth-message');

    try {
      const payload = {
        email: document.getElementById('login-email').value,
        password: document.getElementById('login-password').value,
      };

      const data = await request('/api/login', {
        method: 'POST',
        body: JSON.stringify(payload),
      });

      localStorage.setItem(userStorageKey, JSON.stringify(data.user));
      showMessage(message, 'Login successful. Redirecting...', 'success');
      window.location.href = '/';
    } catch (error) {
      showMessage(message, error.message, 'error');
    }
  });

  forms.signup?.addEventListener('submit', async (event) => {
    event.preventDefault();
    const message = document.getElementById('auth-message');

    try {
      const payload = {
        name: document.getElementById('signup-name').value,
        email: document.getElementById('signup-email').value,
        password: document.getElementById('signup-password').value,
        goal_type: document.getElementById('signup-goal').value,
      };

      const data = await request('/api/users', {
        method: 'POST',
        body: JSON.stringify(payload),
      });

      localStorage.setItem(userStorageKey, JSON.stringify(data.user));
      showMessage(message, 'Account created. Redirecting...', 'success');
      window.location.href = '/';
    } catch (error) {
      showMessage(message, error.message, 'error');
    }
  });
};

const initHomePage = () => {
  const user = ensureLoggedIn();
  if (!user) return;

  const goalForm = document.getElementById('goal-form');
  const mealForm = document.getElementById('meal-form');
  const logoutBtn = document.getElementById('logout-btn');

  logoutBtn?.addEventListener('click', () => {
    localStorage.removeItem(userStorageKey);
    window.location.href = '/login';
  });

  goalForm?.addEventListener('submit', async (event) => {
    event.preventDefault();
    const message = document.getElementById('goal-message');

    try {
      const payload = {
        user_id: user.id,
        title: document.getElementById('goal-title').value,
        description: document.getElementById('goal-notes').value,
        goal_type: document.getElementById('goal-type').value,
        fitness_level: document.getElementById('goal-fitness-level').value,
        equipment: document.getElementById('goal-equipment').value,
        daily_steps: Number(document.getElementById('goal-steps').value) || null,
      };

      await request('/api/goals', {
        method: 'POST',
        body: JSON.stringify(payload),
      });

      showMessage(message, 'Goal saved successfully.', 'success');
      goalForm.reset();
    } catch (error) {
      showMessage(message, error.message, 'error');
    }
  });

  mealForm?.addEventListener('submit', async (event) => {
    event.preventDefault();
    const message = document.getElementById('meal-message');

    try {
      const payload = {
        user_id: user.id,
        meal_name: document.getElementById('meal-name').value,
        meal_type: document.getElementById('meal-type').value,
        calories: Number(document.getElementById('meal-calories').value),
        protein_g: Number(document.getElementById('meal-protein').value) || 0,
        carbs_g: Number(document.getElementById('meal-carbs').value) || 0,
        fats_g: Number(document.getElementById('meal-fats').value) || 0,
      };

      await request('/api/meals', {
        method: 'POST',
        body: JSON.stringify(payload),
      });

      showMessage(message, 'Meal logged successfully.', 'success');
      mealForm.reset();
    } catch (error) {
      showMessage(message, error.message, 'error');
    }
  });
};

document.addEventListener('DOMContentLoaded', () => {
  if (window.location.pathname === '/login' || window.location.pathname === '/login.html') {
    initLoginPage();
    return;
  }

  initHomePage();
});
