# Changelog

## 0.3.1

- "Not in your library" cards (on performer pages and in More like this) get a Whisparr button when the Whisparr Update plugin (0.10 or later) is installed and enabled. A click adds the scene to Whisparr, monitored, and starts a search; a scene already in Whisparr is set monitored and searched for again instead. The button also says what Whisparr has: Downloaded, Wanted (monitored, no file yet) or In Whisparr (not monitored). Cherry Pick asks Whisparr Update through Stash's runPluginOperation, so Whisparr's URL and API key stay in that plugin's settings on the server; a page's cards are looked up in one call.

## 0.3.0 (local copy in lowgrade12/myplugins)

A copy of Cherry Pick 0.2.2 from CandyBoudoir, tuned for very large libraries (tested against 144,500 scenes and 25,900 performers, with every rating set by Restash's mirror). Source in `cherrypick/`, built with `npm run build` into `plugins/CherryPick/`.

- A library check that finds nothing new no longer rebuilds the taste model or rewrites the IndexedDB copy. Every check after two minutes away from the front page did both: on a 144,000-scene library, about a second of frozen page and a rewrite of the whole copy.
- A tool that rewrites most of the library at once is no longer followed scene by scene. Restash's mirror moves about 138,000 scenes' updated_at each day, so every check fetched almost the whole library again (about 300 MB). Past 2,000 edits since the last check, edits wait for the next full read; plays and Os, which teach the model, are always fetched. Performers are now checked for changes the same way instead of read whole on every check (about 35 MB each time).
- The library reads about half as much: scenes carry their tags, performers and studio as ids, with the names read once from the tag, studio and performer lists, and custom fields keep only the keys Cherry Pick reads (ranking plugins' marks, `restash_score` and its own). The full read runs once a week instead of daily.
- The five cross-validation fits behind Your score's gate run one per idle moment after the model is in, starting from the last result this browser kept, instead of in the same task as the fit.
- Saving Cherry Pick's data no longer makes Stash fetch its whole configuration again and redraw every page that reads it, after every bracket pick. The plugin's entry in Stash's cached configuration is updated in place, when Stash's Settings page opens.
- The Bracket and Options buttons on the Performers and Scenes lists watch only the toolbar, not every card in the list.
- The front-page rows redraw only when the rows change, not on every change to the plugin's state. More like this and the performer page's scenes you don't have are worked out again only when what they read changes.
- Relative badges rank a score with a binary search instead of a scan of every unrated scene per card.
- The score line beside the stars is placed again on each new scene.

## 0.2.2

- For you loads again after a scene you played in a scene bracket leaves Stash: deleted, merged into another scene, or removed by Stash's Clean task. Cherry Pick stopped at the bracket's pick on the missing scene and never finished learning your taste, so For you's header said "Learning your taste from … scenes" for good, and Your score, Watch This and the bracket buttons never came. Picks on a scene Stash no longer has now teach Cherry Pick nothing. A paused bracket still shows such a scene as "A removed scene".

Tested beside Ascension 1.4.1, HotOrNot 1.0.0-c4106bf, Stash Curator 0.40.6, Xenith 3.2.0 and Restash 0.3.0-55c1cb2.

## 0.2.1

- Cherry Pick counts a play only as far as the time behind it. Stash records a play from a scene's first second, so a scene swiped past in a feed such as Stash TV's counted like one watched all the way through: For you put its performers, studio and tags forward as what you had been watching, ranked it lower as recently watched, and counted it as a rewatch when it came by again on another day, and Your score read the short play as a sign you disliked the scene. Each tenth of a scene's length played now pays for one play. A scene played for less than that in all was only looked at: it teaches Cherry Pick nothing, and For you and More like this say "Not watched yet". When a scene's play time pays for fewer plays than Stash records, each play, and each day it was played on, counts for that share. A scene you start on its own page and leave within its first tenth no longer counts against it either. Plays with no play time, such as plays added by hand, count as before.

Tested beside Ascension 1.4.1, HotOrNot 1.0.0-c4106bf, Stash Curator 0.40.4, Xenith 3.2.0 and Restash 0.3.0-55c1cb2.

## 0.2.0

- Watch This, a new setting in Cherry Pick's settings, off until you turn it on, puts one scene on the front page in place of Cherry Pick's rows: the one Cherry Pick expects you most want to watch now, in Stash's own player at the page's full width. Stash's own rows stay below it. The player works as on the scene page: Stash records the play and where you stopped, Stash's Auto-start video setting decides whether the scene starts by itself, and Space plays it with no click first. A line under the player gives the scene's title, its performers and why Cherry Pick picked it, and steps out once the scene plays. Nothing happens when the scene ends. For you, the rows that follow your watching and the Hall of Fame row keep their switches for when you turn Watch This off; the Hall of Fame stays on Cherry Pick's page.
- Watch This's Skip, in the line under the player, as the player's next button or with the next-track media key, puts the scene to sleep for 48 hours and shows the next pick, one that shares no performer with the scenes you skipped that visit. A scene skipped again with no play in between sleeps for a week, then for 30 days each time; a play starts it again at 48 hours, and so does a Skip after playing at least a tenth of the scene. A shorter look before Skip doesn't count as a play. Back, in the line or as the player's previous button, brings the last skipped scene back with its sleep as it was. A pick left on screen without being played or skipped, on three different days, sleeps as if skipped. Skips teach Cherry Pick nothing and are kept in Stash's plugin configuration, so they hold on every device.

Tested beside Ascension 1.4.1, HotOrNot 1.0.0-c4106bf, Stash Curator 0.40.4, Xenith 3.2.0 and Restash 0.3.0-55c1cb2.

## 0.1.8

- Your score, For you, More like this and a bracket's cards leave out the tags Advanced Rating and Binge keep for their own use: Advanced Rating's score tags, such as "Production Quality ★: 4", which Binge's stars also write when Advanced Rating is installed, and Binge's collections, such as "Watch Later 📁". Score tags sit only on rated scenes and spell out the rating, so Your score learned a rated scene's rating from them and gave the scene's other tags less weight. Two scenes in the same collection counted as sharing a tag in More like this. Advanced Rating's "Favourite ★" still counts, as your own verdict on a scene.

Tested beside Ascension 1.4.1, HotOrNot 1.0.0-c4106bf, Stash Curator 0.40.4, Xenith 3.2.0 and Restash 0.3.0-55c1cb2.

## 0.1.7

- A scene you don't have links to where to get it on many more cards: its page on the clip store or tube StashDB lists it on (Clips4Sale, iWantClips, ManyVids, Pornhub and the like), with the store's name on the button. Cherry Pick took only the links StashDB files under Studio, which holds paysites; StashDB files a store's link under the store's own name, so about three in four clip-store scenes showed StashDB alone. A store's page comes before the studio's, and a Wayback Machine copy never counts. A scene already in the StashDB cache shows its studio link once more while Cherry Pick asks StashDB about it again in the background, and its store link from then on.
- Pages you have visited before show their StashDB scenes straight away, also after a week. Cherry Pick asked StashDB again for an answer over 7 days old before showing it, so More like this's scenes you don't have could take five seconds to appear. It now shows the answer it has and asks again in the background once the page's own lookups are done, within the same limits (one request a second, six per page). The new answer is kept and shows the next time Stash loads or another page asks for it, so nothing on the page changes while you look at it. Answers are kept for 30 days; an older one is asked for again before it shows.

Tested beside Ascension 1.4.1, HotOrNot 1.0.0-c4106bf, Stash Curator 0.40.4, Xenith 3.2.0 and Restash 0.3.0-55c1cb2.

## 0.1.6

- Every card in Cherry Pick's front-page rows and in More like this ends at the same height, as in Stash's own rows. A card whose reason fit on one line ended about 20px above one whose reason took two, with its counts and ⋯ menu.
- A scene bracket's Look closer opens with Play the preview already under the scrub bar. It appeared a moment later the first time you looked closer at each scene, and the dialog moved up about 20px as it did, so a click or hover just after opening could land below the bar.

Tested beside Ascension 1.4.1, HotOrNot 1.0.0-c4106bf, Stash Curator 0.40.1, Xenith 3.2.0 and Restash 0.3.0-55c1cb2.

## 0.1.5

- In a bracket's first round, the unrated ones meet across the bracket's halves: of 16, the one Cherry Pick rates highest meets the ninth, the second the tenth, and so on. They met their neighbour (first against second), so since 0.1.4 rates every entrant from where it finished, a strong scene or performer that lost to the next strongest in the first round was rated at about the middle of your scale.

Tested beside Ascension 1.4.1, HotOrNot 1.0.0-c4106bf, Stash Curator 0.39.2, Xenith 3.2.0 and Restash 0.3.0-55c1cb2.

## 0.1.4

- More like this no longer makes the scene page scroll sideways in a desktop browser. Its arrows sat past the page's edges, the right one 10px beyond the page and the left one half off it.
- In a window or on a phone narrower than 1200px, More like this no longer covers the scene's performers. Stash keeps the scene's details to the window's height and lets the rest run past, and More like this started where that box ended.
- Your score's ribbon on scene cards runs off the picture's top and left edges like Stash's rating ribbon. Its label is shorter than Stash's "Rating: 5", so the ribbon stopped inside the picture with its end showing.
- Undo leaves alone a rating you changed by hand after Apply and says so: "Left 1 as it is: its rating changed since Apply." It used to put the rating from before Apply back over yours. The same goes for a provisional rating a later bracket stepped down again.
- Apply leaves alone a rating that changed after the bracket offered one, such as a rating you gave by hand in another tab or on Stash's own pages while the preview was open, and says so: "Left 1 as it is: its rating changed since the bracket offered one." It used to write the bracket's rating over yours. Apply bracket ratings automatically does the same.
- On a Stash whose server runs behind UTC, a rating you set on Stash's own pages, or one an earlier Apply wrote, reaches Cherry Pick at your next visit. Cherry Pick asked Stash for the scenes changed since its last look by a UTC time, which Stash compared with its own local time, so on a server at UTC−4 it found nothing for four hours and rated scenes came back as unrated in the next bracket. It now reads the latest edits, plays and Os newest first and compares the times itself. O counts reach it the same way, and it reads your whole library again once a day even when you visit every day, where each visit used to put that off. Each browser reads the library in full once after this update.
- Scene brackets draw from every scene you own, watched or not, as performer brackets draw from everyone with a photo. They drew only from scenes Stash had recorded a play for, so in a library where you mostly watch outside Stash's own player the same few scenes played in every bracket. Audio-only files and scenes marked Don't learn from this stay out.
- Each side of a scene match shows the cover and eight frames spread over the scene, its studio, year, length and resolution, up to four performers' faces and a row of tags, so you can judge a scene you have never watched. A click or a tap on the cover picks it. A frame opens one scene large at that moment, and Look closer, or 1 and 2 on the keyboard, opens it on the cover: step through its frames with the arrow keys (Shift for ten at a time) or scrub along the bar, play Stash's preview clip, and read every performer, the description and every tag. Enter picks, O switches to the other scene and Esc goes back to the match. The frames and the preview are the ones Stash generated, so they work whatever the scene's format, and nothing records a play. A scene Stash has no previews for says so. The Challenge round's scene matches work the same way.
- In a scene bracket, a pick within 400 ms of the last one is ignored, so a double tap can't also pick in the next match.
- A finished bracket rates every performer or scene that played in it, first-round losers included, from where each finished, so a bracket sets ratings without the Challenge round or stars you give the champion. Its places are spread over what Cherry Pick expects you to think of your library, so its finishing order is laid over your own ratings: in a 16-place bracket drawn from your whole library the champion gets about the rating of your top sixteenth and the last place about your bottom sixteenth, and a bracket of one performer's scenes sits where those scenes sit in your library. With fewer than ten ratings of your own it uses Your score's spread for scenes, or one to five stars. These ratings are provisional, so a later bracket can correct them, and none goes above half a star under a rated performer or scene that beat it. It used to rate only the champion, finalist, semifinalists and quarterfinalists, and only once the Challenge round or your stars had placed the champion.
- The Challenge round is optional, behind Test the champion. Where it stops sets the champion's rating as before, and the rest move by the same amount, so the order holds. Rate them myself sets the champion's stars by hand and moves the rest the same way. The champion screen no longer says closing would set no ratings.
- Bracket's tooltip on more than 16 scenes reads "Bracket 16 of the 60 scenes in this list, from likely best to likely worst", and the same on a performer's scenes. It called them your top 16, and a bracket spreads its 16 places over the whole range of what Cherry Pick expects you to think of them.

Tested beside Ascension 1.4.1, HotOrNot 1.0.0-c4106bf, Stash Curator 0.39.1, Xenith 3.2.0 and Restash 0.3.0-55c1cb2.

## 0.1.3

- Brackets play the performers and scenes you haven't rated. People rate their favorites, so the rated ones won their way to nearly every final; they now play only when there aren't enough unrated ones to fill a bracket. Performers and scenes from your last three brackets of the same kind and gender sit out while others can take their places.
- The Challenge round: after the final, a champion with no rating of yours meets up to three performers or scenes you have rated, lowest rated first, until one beats it. Where it stops sets the champion's rating in Apply, and the finalist and semifinalists step down from it. A champion that beats every one gets a trophy on its performer card, "beat your favorites" in its For you line and a mark in the Hall of Fame. Rate them myself skips it.
- A loss to a rated performer or scene no longer sets a rating on its own. A first-round loser to your 5★ favorite was offered 4.5★.
- Scene brackets work the same way: scenes you have rated sit out while four unrated ones can play, so "Bracket her scenes" plays the ones you haven't rated and her rated ones wait for the champion. A champion meets the rated ones from its own list first.
- Apply bracket ratings automatically, a new switch under Settings > Plugins: closing a bracket's champion screen sets its ratings, and Cherry Pick's page keeps each batch with Undo. While nothing places the champion yet, the screen says closing would set none. It starts on, and off while Ascension, HotOrNot, Xenith or Restash's mirror writes your ratings, and follows those plugins until you set it yourself.

## 0.1.2

- On a browser's first visit, and after a day away, For you's header says what is happening while its row of placeholder cards waits: "Reading your library: 4,500 of 25,000 scenes", then "Learning your taste from 25,000 scenes". On a library of 25,000 scenes that takes about 6 seconds. Other visits start from the browser's copy of your library, take about 2 to 3 seconds and show no line.
- While Cherry Pick is still reading your library, Bracket and Options beside the Performers and Scenes lists say so when you point at them, instead of sitting greyed out with no reason.

## 0.1.1

- Your score now shows on scenes whose only rating another plugin set: Ascension's or Xenith's Elo score, the random starting rating of Ascension's Prime tasks, or Restash's mirrored score. Cherry Pick already counted those scenes as unrated, but hid Your score on them, so the scenes Prime Unrated Scenes primed lost it. It takes the card's rating corner, where Ascension and Xenith already hide Stash's rating, and shows beside the stars on the scene page. A rating you set yourself still hides it.
- Your score's badge dims the cover behind it with a half-black background instead of a backdrop filter, which stopped a page with a few dozen badges from rendering in WebKit on Linux.
- Checked live beside Ascension 1.4.1 (its battle dialog in every mode, Performer Statistics, the Metrics Dashboard and every task, at 390px under Juicy and Leather too) and Restash 0.3.0 (its scoring with the mirror off and on, and Restore Ratings).

## 0.1.0

First release, for Stash v0.31.1, under the AGPL-3.0.

- For you, the front page's first row: 12 scenes you own, ranked by your taste, your last two weeks of watching, how long since you played each (scenes you have seen come back only if you rewatch) and a little variety, each with the reason it is there. Up to two rows follow when your watching calls for them, then the Hall of Fame.
- Your score, a likely rating learned from your ratings, how you watch and your bracket picks, on unrated scene cards and beside the stars on scene pages. It shows only once it predicts your ratings better than your average does, and it never changes your ratings.
- With fewer than 10 rated scenes, For you ranks by the performers you favorite or rate, and For you, the scene page and Cherry Pick's page say how many ratings Your score still needs, with a link to your unrated scenes and a one-click bracket.
- More like this under the player: barely played scenes in your library, then, with a StashDB key, scenes you don't have.
- Performer and scene brackets beside the Performers and Scenes lists: one click starts 16, Options picks 32 or 64, the gender and the pool. Set genders fills a short pool by hand. A bracket pairs performers or scenes you haven't rated with ones you have, shows no ratings or seeds while you pick, and offers Stash ratings for the unrated ones from where they finished against the rated ones, with a preview and Undo. A performer you haven't rated who is in two or more scenes you have rated counts as rated at the average of those scene ratings, so performer brackets have ratings to measure against when you rate only scenes; Apply never rates that performer. In a bracket where none of them counts as rated, you rate the champion and the others step down from it, marked provisional so a later bracket can correct them. Brackets pause and resume, write the results to performers' custom fields and build a Hall of Fame with Champions rounds.
- A For you line on performer pages and crowns and medals on performer cards.
- With a StashDB key: how widely a scene is held, its rank among a performer's scenes, and a performer's scenes you don't have. Connect StashDB helps you get a key and adds it to Stash.
- Not interested and Don't learn from this, eleven switches and a tag exclusion list under Settings > Plugins, and Cherry Pick's own page with Remove Cherry Pick data.
- Nothing appears while a scene plays.
- Beside Ascension, HotOrNot, Xenith or Restash: the ratings they set (the Elo scores of the first three, Ascension's Prime, and Restash's score when its mirror writes it to Stash's rating) stay out of what Cherry Pick learns. Apply never rates a record whose rating they set, and says when Ascension, HotOrNot or Xenith will pick up its ratings.
- Your score shows beside Ascension's and Xenith's badges on scene cards, crowns and medals sit above Xenith's badge on performer cards, and HotOrNot's floating button goes under Cherry Pick's dialogs so it can't cover their buttons on a phone.
- Learn from Ascension, HotOrNot and Xenith matches, a switch under Settings > Plugins that starts on: each match those plugins recorded teaches Your score and For you as half a bracket pick, and Cherry Pick's page counts them.
- Beside Stash Curator: the Scenes and Performers lists render with both installed, and Bracket on a list filtered by Curator Appeal or Curator affinity leaves that criterion out and says so in the pool's name. Cherry Pick's page and its settings ask once whether to hide Your score on cards, which carry Curator's Appeal score too: Hide on cards turns off Score badges on cards and keeps Your score on scene pages, and Keep both leaves it on.
