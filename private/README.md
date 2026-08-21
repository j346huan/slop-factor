# Private review workspace

Candidate reports, downloaded papers, and API query state belong under this directory during local
administrative review. JSON reports and downloaded assets are ignored by Git and are not imported by
the website build.

The daily workflow uploads its candidate report as a restricted Actions artifact and synchronizes
matches to private issues labeled `paper-candidate` and `candidate:pending`. It verifies through the
GitHub API that the repository is private before discovery. It does not commit candidate data, modify
approved data, or deploy candidates.

The issue queue is the persistent administrator review state used by the authenticated website
dashboard. Existing approval submissions, approvals, or rejections are never reset by a later scan of
the same arXiv version. Neither the dashboard nor the scanning pipeline uses an AI service.
