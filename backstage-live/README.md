# Backstage Live

Real observation layer for your meeting platform. Read **PLAN.md** first — it is the spec.

~~~bash
cp .env.example .env      # fill in MONGODB_URI and ANTHROPIC_API_KEY
npm install
npm run dev               # console + ingest on :8790
~~~

Then apply the two patches in `patches/` to your canvas repo. Nothing is observed until
you do — this service has no way to see a meeting on its own, by design.

**Order of work is in PLAN.md section 3. Do not skip Phase 1's acceptance test.**
