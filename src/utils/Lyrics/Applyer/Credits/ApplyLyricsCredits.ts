interface LyricsData {
  SongWriters?: string[];
  Provider?: string;
  Author?: string;
  IsCommunity?: boolean;
  Type?: string;
  Content?: any;
  classes?: string;
  styles?: Record<string, string>;
}

export function ApplyLyricsCredits(data: LyricsData, LyricsContainer: HTMLElement): void {
  if (!LyricsContainer) return;

  const oldCredits = LyricsContainer.querySelector(".Credits");
  if (oldCredits) oldCredits.remove();

  const CreditsElement = document.createElement("div");
  CreditsElement.classList.add("Credits");

  // 1. Written by: <SongWriters>
  if (data?.SongWriters?.length) {
    const writersDiv = document.createElement("div");
    writersDiv.classList.add("CreditItem", "SongWritersLine");
    writersDiv.textContent = `Written by: ${data.SongWriters.join(", ")}`;
    CreditsElement.appendChild(writersDiv);
  }

  // 2. Provided by: <Provider>
  const providerName = data?.Provider || "Apple Music";
  const providerDiv = document.createElement("div");
  providerDiv.classList.add("CreditItem", "ProviderLine");
  providerDiv.textContent = `Provided by: ${providerName}`;
  CreditsElement.appendChild(providerDiv);

  // 3. These lyrics have been provided by our community
  if (data?.IsCommunity) {
    const communityDiv = document.createElement("div");
    communityDiv.classList.add("CreditItem", "CommunityNotice");
    communityDiv.textContent = "These lyrics have been provided by our community";
    CreditsElement.appendChild(communityDiv);
  }

  // 4. Made by @<Author>
  if (data?.Author) {
    const authorDiv = document.createElement("div");
    authorDiv.classList.add("CreditItem", "AuthorLine");
    const cleanAuthor = data.Author.startsWith("@") ? data.Author : `@${data.Author}`;
    authorDiv.textContent = `Made by ${cleanAuthor}`;
    CreditsElement.appendChild(authorDiv);
  }

  LyricsContainer.appendChild(CreditsElement);
}
