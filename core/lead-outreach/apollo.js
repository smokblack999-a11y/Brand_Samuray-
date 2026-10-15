"use strict";

class ApolloAdapter {
  constructor(options = {}) {
    this.apiKey = String(options.apiKey || "").trim();
    this.fetch = options.fetch || globalThis.fetch;
    this.endpoint = options.endpoint || "https://api.apollo.io/api/v1/mixed_people/api_search";
  }

  async search(filters = {}) {
    if (!this.apiKey) {
      const error = new Error("Apollo API key is not configured");
      error.code = "APOLLO_NOT_CONFIGURED";
      error.statusCode = 503;
      throw error;
    }
    if (typeof this.fetch !== "function") throw new Error("This Node.js runtime does not provide fetch");

    const limit = Math.max(1, Math.min(Number(filters.limit) || 10, 25));
    const payload = {
      person_titles: Array.isArray(filters.personTitles) ? filters.personTitles.slice(0, 10) : [],
      person_locations: Array.isArray(filters.locations) ? filters.locations.slice(0, 10) : [],
      q_organization_domains_list: Array.isArray(filters.domains) ? filters.domains.slice(0, 25) : [],
      page: 1,
      per_page: limit
    };
    if (Array.isArray(filters.industries) && filters.industries.length) {
      payload.organization_industry_tag_ids = filters.industries.slice(0, 20);
    }

    const response = await this.fetch(this.endpoint, {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-Api-Key": this.apiKey, "Cache-Control": "no-store" },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(15000)
    });
    if (!response.ok) {
      const error = new Error(response.status === 401 || response.status === 403
        ? "Apollo authentication or plan permission failed"
        : `Apollo API returned HTTP ${response.status}`);
      error.code = "APOLLO_API_ERROR";
      error.statusCode = response.status === 429 ? 429 : response.status >= 500 ? 502 : 400;
      throw error;
    }
    const data = await response.json();
    const people = Array.isArray(data.people) ? data.people : [];
    return people.slice(0, limit).map((person) => {
      const org = person.organization || {};
      return {
        source: "apollo",
        sourceId: person.id ? String(person.id) : null,
        company: org.name || person.organization_name || null,
        name: [person.first_name, person.last_name].filter(Boolean).join(" ") || null,
        title: person.title || null,
        email: person.email || null,
        website: org.website_url || org.primary_domain || null,
        location: [person.city, person.state, person.country].filter(Boolean).join(", ") || null,
        rawStatus: person.email_status || null
      };
    }).filter((person) => person.sourceId || person.email || person.company);
  }
}

module.exports = { ApolloAdapter };
