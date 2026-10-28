import { expect } from '@playwright/test';
import { test } from './fixtures/users';

// eslint-disable-next-line @typescript-eslint/no-require-imports
const { prisma } = require('../../api/src/database/client');

test.describe('Editorial Journey', () => {
  let createdArticleId: string;
  let articleTitle: string;

  test.afterEach(async () => {
    if (createdArticleId) {
      // Cleanup the created article. ArticleRevisions and ArticleTags will cascade delete.
      await prisma.article.deleteMany({
        where: { id: createdArticleId }
      });
    }
  });

  test('author to editor full flow', async ({ page, authorUser, editorUser }) => {
    // 1. Author login
    await page.goto('/cms/login');
    await page.fill('input[type="email"]', authorUser.email);
    await page.fill('input[type="password"]', authorUser.password);
    await page.click('button[type="submit"]');

    // Wait for CMS dashboard
    await expect(page).toHaveURL('/cms');

    // 2. Create Draft
    await page.goto('/cms/articles/new');
    await expect(page.locator('#article-title')).toBeVisible();
    
    articleTitle = `E2E Test Article ${Date.now()}`;
    await page.fill('#article-title', articleTitle);
    await page.fill('label:has-text("Body") + textarea', 'This is the body of the E2E article.');
    await page.click('button:has-text("Save Article")');

    // Should navigate to edit page
    await expect(page).not.toHaveURL(/\/cms\/articles\/new$/);
    await expect(page).toHaveURL(/\/cms\/articles\/[^/]+$/);

    // Get the article ID
    const url = page.url();
    createdArticleId = url.split('/').pop()!;

    // Wait for status to show DRAFT
    await expect(page.locator('span:has-text("DRAFT")')).toBeVisible();

    // 3. Submit Review
    const submitButton = page.getByRole('button', { name: 'Submit for Review' });
    await expect(submitButton).toBeVisible();
    await expect(submitButton).toBeEnabled();
    await submitButton.click();
    // Wait for status update
    await expect(page.locator('span:has-text("SUBMITTED_FOR_REVIEW")')).toBeVisible();

    // Logout author
    await page.click('button:has-text("Logout")');
    await expect(page).toHaveURL('/cms/login');

    // 4. Editor login
    await page.fill('input[type="email"]', editorUser.email);
    await page.fill('input[type="password"]', editorUser.password);
    await page.click('button[type="submit"]');
    await expect(page).toHaveURL('/cms');

    // 5. Navigate to article
    await page.goto(`/cms/articles/${createdArticleId}`);

    // Wait for article to load
    await expect(page.locator('span:has-text("SUBMITTED_FOR_REVIEW")')).toBeVisible();

    // 6. Start Review
    await page.click('button:has-text("Start Review")');
    await expect(page.locator('span:has-text("UNDER_REVIEW")')).toBeVisible();

    // 7. Approve
    await page.click('button:has-text("Approve")');
    await expect(page.locator('span:has-text("APPROVED")')).toBeVisible();

    // 8. Publish
    await page.click('button:has-text("Publish Now")');
    await expect(page.locator('span:has-text("PUBLISHED")')).toBeVisible();

    // 9. Verify on public site
    await page.goto('/');
    
    // Check if the article title is on the home page
    const articleLink = page.locator(`a:has-text("${articleTitle}")`);
    await expect(articleLink).toBeVisible();

    // Click it to go to article page
    await articleLink.click();

    // Verify title and body on public route
    await expect(page.locator(`h1:has-text("${articleTitle}")`)).toBeVisible();
    await expect(page.locator('text="This is the body of the E2E article."')).toBeVisible();
  });
});
