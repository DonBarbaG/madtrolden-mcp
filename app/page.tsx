// Deliberately boring landing page: says what this is, nothing more.
// No data, no endpoints enumerated, no client JS.

export default function Home() {
  return (
    <main
      style={{
        minHeight: "100vh",
        display: "grid",
        placeItems: "center",
      }}
    >
      <div style={{ maxWidth: "36rem", padding: "2rem", lineHeight: 1.6 }}>
        <h1 style={{ fontSize: "1.6rem", marginBottom: "0.5rem" }}>madtrolden 🧌</h1>
        <p style={{ opacity: 0.85 }}>
          en privat mcp-server til familie og venner: planlægger billig mad ud fra ugens danske
          tilbudsaviser — budgetloft, madplan, indkøbsliste og nærmeste butikker, direkte i din egen
          claude.
        </p>
        <p style={{ opacity: 0.6, fontSize: "0.9rem" }}>
          adgang kræver en personlig nøgle. har du fået en, så følg{" "}
          <a href="https://github.com/DonBarbaG/madtrolden-mcp/blob/main/ONBOARDING.md">
            opsætningsguiden
          </a>{" "}
          — eller brug <a href="/plan">planlæggeren</a>.
        </p>
        <p style={{ opacity: 0.4, fontSize: "0.8rem" }}>
          bygget på{" "}
          <a href="https://github.com/olgasafonova/tilbudstrolden-mcp">tilbudstrolden-mcp</a> (mit)
          · data fra etilbudsavis/tjek, dawa og dtu fødevareinstituttet.
        </p>
      </div>
    </main>
  );
}
