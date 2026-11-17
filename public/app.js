// Handles login, dashboard actions, and community feed interactions.
const userStorageKey = 'wellness-user';

// Handles the Checks of if the user is signed in,
// if not redirect to login page
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

const logout = async (messageElement) => {
  try {
    await request('/api/logout', { method: 'POST' });
    localStorage.removeItem(userStorageKey);
    window.location.href = '/login';
  } catch (error) {
    showMessage(messageElement, error.message, 'error');
  }
};

const request = async (url, options = {}) => {
  const response = await fetch(url, {
    ...options,
    headers: {
      ...(options.body instanceof FormData ? {} : { 'Content-Type': 'application/json' }),
      ...options.headers,
    },
  });

  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(data.message || 'Request failed.');
  }

  return data;
};

// Handling login and signup page behavior
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

// Home dashboard behavior for saving goals and meals.
// Personal tracking goals, meal logging, and fitness tracking. WIP
const initHomePage = () => {
  const user = ensureLoggedIn();
  if (!user) return;

  const goalForm = document.getElementById('goal-form');
  const mealForm = document.getElementById('meal-form');
  const logoutBtn = document.getElementById('logout-btn');

  logoutBtn?.addEventListener('click', () => logout(null));

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

// Community feed behavior 
const initCommunityPage = () => {
  const user = ensureLoggedIn();
  if (!user) return;

  const form = document.getElementById('post-form');
  const composer = document.getElementById('post-composer');
  const toggleButton = document.getElementById('toggle-post-form');
  const postList = document.getElementById('post-list');
  const feedFilter = document.getElementById('post-feed-filter');
  const message = document.getElementById('post-message');
  const feedMessage = document.getElementById('feed-message');
  const submitButton = document.getElementById('submit-post');

  document.getElementById('logout-btn')?.addEventListener('click', () => logout(feedMessage));

  const setComposerOpen = (isOpen) => {
    composer.hidden = !isOpen;
    toggleButton.setAttribute('aria-expanded', String(isOpen));
    if (!isOpen) {
      form.reset();
      showMessage(message, '');
    }
  };

  toggleButton.addEventListener('click', () => setComposerOpen(composer.hidden));
  document.getElementById('cancel-post').addEventListener('click', () => setComposerOpen(false));

  const loadPosts = async () => {
    postList.replaceChildren();
    const feed = feedFilter.value;

    if (feed === 'friends') {
      const emptyMessage = document.createElement('p');
      emptyMessage.className = 'card empty-feed';
      emptyMessage.textContent = 'Friends’ posts will appear here once friend connections are available.';
      postList.append(emptyMessage);
      return;
    }

    // Fetch and display posts based on the selected feed listed here
    try {
      const posts = await request(`/api/posts?feed=${encodeURIComponent(feed)}`);
      if (posts.length === 0) {
        const emptyMessage = document.createElement('p');
        emptyMessage.className = 'card empty-feed';
        const emptyMessages = {
          recent: 'No posts yet. Be the first to share something!',
          mine: 'You haven’t shared any posts yet.',
          recommended: 'No recommended posts yet. Recommendations are based on shared fitness goals or fitness levels.',
        };
        emptyMessage.textContent = emptyMessages[feed] || 'No posts found.';
        postList.append(emptyMessage);
        return;
      }

      posts.forEach((post) => {
        const article = document.createElement('article');
        article.className = 'card community-post';

        const title = document.createElement('h2');
        title.textContent = post.title;
        const metadata = document.createElement('p');
        metadata.className = 'post-metadata';
        metadata.textContent = `By ${post.author} · ${new Date(post.created_at).toLocaleString()}`;
        const contents = document.createElement('p');
        contents.className = 'post-contents';
        contents.textContent = post.contents;
        article.append(title, metadata, contents);
        (post.image_urls || []).forEach((imageUrl) => {
          const image = document.createElement('img');
          image.src = imageUrl;
          image.alt = `Photo attached to ${post.title}`;
          image.loading = 'lazy';
          article.append(image);
        });
        (post.video_urls || []).forEach((videoUrl) => {
          const video = document.createElement('video');
          video.src = videoUrl;
          video.controls = true;
          video.preload = 'metadata';
          video.playsInline = true;
          video.setAttribute('aria-label', `Video attached to ${post.title}`);
          article.append(video);
        });

        if (Number(post.user_id) === Number(user.id)) {
          const actions = document.createElement('div');
          actions.className = 'user-post-controls';

          const editButton = document.createElement('button');
          editButton.className = 'ghost-action-btn';
          editButton.type = 'button';
          editButton.textContent = 'Edit';
          editButton.setAttribute('aria-expanded', 'false');
          editButton.setAttribute('aria-controls', `edit-post-${post.id}`);

          const deleteButton = document.createElement('button');
          deleteButton.className = 'danger-action-btn';
          deleteButton.type = 'button';
          deleteButton.textContent = 'Delete';

          const editForm = document.createElement('form');
          editForm.className = 'edit-post-box';
          editForm.id = `edit-post-${post.id}`;
          editForm.hidden = true;
          const titleLabel = document.createElement('label');
          titleLabel.textContent = 'Title';
          const titleInput = document.createElement('input');
          titleInput.name = 'title';
          titleInput.maxLength = 150;
          titleInput.required = true;
          titleInput.value = post.title;
          titleLabel.append(titleInput);

          const contentsLabel = document.createElement('label');
          contentsLabel.textContent = 'Post';
          const contentsInput = document.createElement('textarea');
          contentsInput.name = 'contents';
          contentsInput.rows = 5;
          contentsInput.maxLength = 10000;
          contentsInput.required = true;
          contentsInput.value = post.contents;
          contentsLabel.append(contentsInput);

          const formActions = document.createElement('div');
          formActions.className = 'edit-post-footer';
          const saveButton = document.createElement('button');
          saveButton.className = 'save-post-btn';
          saveButton.type = 'submit';
          saveButton.textContent = 'Save changes';
          const cancelButton = document.createElement('button');
          cancelButton.className = 'cancel-post-btn';
          cancelButton.type = 'button';
          cancelButton.textContent = 'Cancel';
          formActions.append(saveButton, cancelButton);
          editForm.append(titleLabel, contentsLabel, formActions);
          actions.append(editButton, deleteButton);
          article.append(actions, editForm);

          editButton.addEventListener('click', () => {
            editForm.hidden = !editForm.hidden;
            editButton.setAttribute('aria-expanded', String(!editForm.hidden));
          });
          cancelButton.addEventListener('click', () => {
            titleInput.value = post.title;
            contentsInput.value = post.contents;
            editForm.hidden = true;
            editButton.setAttribute('aria-expanded', 'false');
          });
          editForm.addEventListener('submit', async (event) => {
            event.preventDefault();
            saveButton.disabled = true;
            try {
              await request(`/api/posts/${post.id}`, {
                method: 'PUT',
                body: JSON.stringify({
                  title: titleInput.value,
                  contents: contentsInput.value,
                }),
              });
              await loadPosts();
              showMessage(feedMessage, 'Post updated successfully.', 'success');
            } catch (error) {
              showMessage(feedMessage, error.message, 'error');
              saveButton.disabled = false;
            }
          });
          deleteButton.addEventListener('click', async () => {
            if (!window.confirm('Delete this post? This cannot be undone.')) return;
            deleteButton.disabled = true;
            try {
              await request(`/api/posts/${post.id}`, {
                method: 'DELETE',
              });
              await loadPosts();
              showMessage(feedMessage, 'Post deleted successfully.', 'success');
            } catch (error) {
              showMessage(feedMessage, error.message, 'error');
              deleteButton.disabled = false;
            }
          });
        }

        postList.append(article);
      });
    } catch (error) {
      showMessage(postList, error.message, 'error');
    }
  };

  feedFilter.addEventListener('change', loadPosts);

  // Handling post submission
  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    showMessage(message, '');
    showMessage(feedMessage, '');
    submitButton.disabled = true;

    try {
      const formData = new FormData(form);
      await request('/api/posts', { method: 'POST', body: formData });
      form.reset();
      setComposerOpen(false);
      await loadPosts();
      showMessage(feedMessage, 'Post shared successfully.', 'success');
    } catch (error) {
      showMessage(message, error.message, 'error');
    } finally {
      submitButton.disabled = false;
    }
  });

  loadPosts();
};

// Initialize the appropriate page
document.addEventListener('DOMContentLoaded', () => {
  if (window.location.pathname === '/login' || window.location.pathname === '/login.html') {
    initLoginPage();
    return;
  }

  if (window.location.pathname === '/community' || window.location.pathname === '/community.html') {
    initCommunityPage();
    return;
  }

  initHomePage();
});
