/* Help: quick start guide and FAQ.
   Content lives in QUICK_START and FAQ below; everything else is rendering.
   Links inside the content:
     <a data-faq="id">        opens that question in the FAQ
     <a data-act="settings:data"> closes help and opens that part of the app */
(function () {
  'use strict';

  // ------------------------------------------------------------------ content: quick start
  const QUICK_START_INTRO = `
    <p>This guide takes you from a first look around to handing printed call lists to your hub coordinators.
    For a church of around a hundred people, allow an hour or so the first time. Most of that is deciding who should be a hub coordinator,
    which is worth talking through with your leaders anyway.</p>`;

  const QUICK_START = [
    {
      id: 'demo',
      title: 'Have a look around the demo',
      html: `
        <p>The first time the app opens, it shows a made-up church called Riverside Community Church. Nobody in it is real, so you can click around,
        tick boxes and move people between hubs without worrying about anything. The orange <b>DEMO</b> badge in the title bar tells you when you're looking at it.</p>
        {{fig:overview}}
        <p>Everything else lives in the <b>Menu</b> button in the top right corner: bringing in contacts, the hub groups, the table view, reports,
        settings and this help.</p>
        {{fig:menu}}
        <p>Click a dot to see who lives there and open their card. Where dots are close together they're gathered into a numbered circle,
        and clicking that splits it into the separate households. The lines show the plan: a thick line from the church to each hub coordinator, then thinner lines from each
        hub coordinator to the people they'll phone.</p>`,
    },
    {
      id: 'switch',
      title: 'Switch to your own data',
      html: `
        <p>When you're ready to start on the real thing, open <a data-act="settings:data">Settings &rarr; Data &amp; privacy</a> and untick <b>Demo on</b>.
        The page reloads with your own system, which starts off empty. Clicking the DEMO badge takes you to the same place.</p>
        {{fig:demo-switch}}
        <p>The demo is kept separately from your real list, so you can switch back whenever you want to show someone how it works,
        and nothing you do in one affects the other.</p>`,
    },
    {
      id: 'church',
      title: 'Tell it about your church',
      html: `
        <p>In <a data-act="settings:org">Settings &rarr; Organisation details</a>, add your church's name and logo. They appear in the title bar and on the printed call lists.</p>
        <p>Then set up the <b>central hub</b>. This is the place every hub coordinator reports back to, usually your church building or office.
        Type its postcode and press <b>Find</b>, or use <b>Pick the position on the map</b> if the postcode puts it slightly in the wrong spot.
        Fill in the contact details too, because they're printed on the call lists so people know who to ring. Press <b>Save</b> when you're done.</p>
        {{fig:settings-org}}
        <p>You can leave <b>Grouping levels</b> at 1 for now. It's only needed if your church is big enough for hubs within hubs
        (<a data-faq="levels">there's more about that in the FAQ</a>).</p>`,
    },
    {
      id: 'contacts',
      title: 'Bring in your contact list',
      html: `
        <p>There are two ways to do this.</p>
        <ul>
          <li><b>Upload a CSV file.</b> Export your address list from your church database or spreadsheet as a CSV file, then click
          <b>Upload contacts CSV</b> in the menu, or drag the file onto the page. First and last names are essential, and addresses,
          postcodes and phone numbers make it useful. There's an example, <i>contacts-template.csv</i>, in the <i>app</i> folder,
          and the FAQ explains <a data-faq="csv">which columns it understands</a>.</li>
          <li><b>Connect ChurchSuite.</b> If your church uses ChurchSuite, the app can fetch the list for you. You set it up once in
          <a data-act="settings:data">Settings &rarr; Data &amp; privacy</a>, choose which tags to include, and from then on click
          <b>Sync from ChurchSuite</b> in the menu whenever you want the latest list. The FAQ has <a data-faq="churchsuite">step-by-step instructions for connecting it</a>.</li>
        </ul>
        <p>Either way, the app looks up each postcode to put people on the map, then shows you a report of who was added, removed or changed.</p>
        {{fig:changes-report}}
        <p>Afterwards, choose <a data-act="unmapped">Not on map</a> from the menu. It lists anyone the app couldn't place, usually because of a missing or
        mistyped postcode. Fix the address in your church database so it's right next time, or open the person's card and use <b>Place on map by hand</b>.</p>`,
    },
    {
      id: 'protect',
      title: 'Look after the data',
      html: `
        <p>Once real people are in the list, take ten minutes over this. In <a data-act="settings:data">Settings &rarr; Data &amp; privacy</a> you can:</p>
        <ul>
          <li><b>Turn on encryption.</b> The data on this computer then can't be read without a passphrase. Agree where the passphrase will be kept
          before you switch it on, because if it's lost there's no way to get the data back. There's <a data-faq="encryption">more about encryption</a> in the FAQ.</li>
          <li><b>Create the Data Protection Pack.</b> Add your data protection lead's name and contact details, then create the pack. It's a PDF in your
          church's branding that explains your responsibilities under UK law, with a paragraph for your privacy notice and a confidentiality
          agreement for hub coordinators to sign.</li>
        </ul>
        <p>If you plan to record who is vulnerable, or anything about people's health, both of these are well worth doing before you start ticking boxes.</p>`,
    },
    {
      id: 'statuses',
      title: 'Choose hub coordinators and tick statuses',
      html: `
        <p>This is the part that needs some thought. Pick people spread across your area who would be willing to make a handful of phone calls in an
        emergency. For each one, click their dot (or type their name in <b>Find a person</b> on the left), and tick <b>Hub Coordinator</b> on their card.
        Everyone else is then linked to whichever hub coordinator lives nearest.</p>
        {{fig:card}}
        <p>While you're on people's cards, tick any other statuses that apply, such as <b>Vulnerable</b> or <b>Single occupancy</b>, and add notes a hub
        coordinator would want to know, like "uses a wheelchair" or "no mobile signal". Everything saves as soon as you change it.</p>
        <p>If you'd rather work down a list than click around the map, <a data-act="table">Table view</a> lets you tick statuses for everyone on one screen.
        The statuses themselves are up to you: rename them, change their colours or add your own in <a data-act="settings:status">Settings &rarr; Statuses</a>.</p>`,
    },
    {
      id: 'hubs',
      title: 'Check the hub groups',
      html: `
        <p>Click <a data-act="hubs">Hub groups</a> to see who is in each group, nearest first. Look out for groups that are much bigger than the rest, and for
        people who are close as the crow flies but awkward to reach in practice, perhaps on the far side of a river or a main road.</p>
        {{fig:hub-groups}}
        <p>To move someone, open their card and choose a different hub coordinator from the list. A hub you've chosen by hand shows as a dashed line on
        the map, and it stays that way when you upload a new list. If a group is still too big, adding another hub coordinator nearby is usually the
        easiest fix, since people move to whoever is now closest.</p>`,
    },
    {
      id: 'print',
      title: 'Print the call lists, and keep them current',
      html: `
        <p>Click <b>Print call lists</b> in the Paper call lists box on the left, or in Hub groups. Each hub gets its own pages, with the hub coordinator's
        details, who to report back to, a map with numbered homes, and a list of people to ring with boxes to tick as they go.
        If you'd prefer one compact page per hub, untick <b>Include maps</b> in Hub groups before printing.</p>
        {{fig:printed-list}}
        <p>When the copies are printed and handed out, click <b>Confirm call lists printed</b>. The date appears on the left, and if anything on the
        lists changes after that, such as a new phone number, someone moving house or a new hub coordinator, you'll see a warning that the paper
        copies are out of date.</p>
        {{fig:paper-panel}}
        <p>A good habit is to refresh your contact list every month or two and reprint whenever that warning appears. In an emergency the paper lists
        are what people will actually use, so it's worth keeping them up to date.</p>`,
    },
  ];
  const QUICK_START_OUTRO = `
    <p>That's everything you need to get going. The <a data-tab="faq">FAQ</a> covers the details, including what happens to your data,
    how people are matched up between uploads and how hubs are worked out.</p>`;

  const FIGS = {
    overview: {
      src: 'help/overview.jpg', alt: 'The main screen showing the demo church on a map',
      caption: `<ol class="help-callouts">
        <li>The menu, for bringing in contacts, hub groups, the table view, reports, settings and help.</li>
        <li>The Paper call lists box, with the date the lists were last printed.</li>
        <li>The legend. Untick a status to hide those people from the map.</li>
        <li>Each dot is a household, coloured by the most important status of anyone living there.</li></ol>`,
    },
    menu: { w: 300, src: 'help/menu.jpg', alt: 'The menu open, listing everything the app can do', caption: 'The menu, opened from the top right corner.' },
    'demo-switch': { src: 'help/demo-switch.jpg', alt: 'The Demo mode section of the settings', caption: 'The demo switch is at the top of the Data &amp; privacy tab.' },
    'settings-org': { src: 'help/settings-org.jpg', alt: 'The Organisation details tab of the settings', caption: 'Your church\'s name, logo and central hub.' },
    'changes-report': { src: 'help/changes-report.jpg', alt: 'A changes report after loading a contact list', caption: 'After every upload or sync you get a report like this. Older ones are kept under Changes report.' },
    card: { w: 600, src: 'help/card.jpg', alt: 'A contact card with statuses ticked', caption: 'A contact card. Ticking a box saves it straight away.' },
    'hub-groups': { src: 'help/hub-groups.jpg', alt: 'The hub groups window listing each hub and its members', caption: 'Hub groups, with each group\'s people listed nearest first.' },
    'printed-list': { w: 560, src: 'help/printed-list.jpg', alt: 'A printed call list with a map and a table of people to ring', caption: 'A printed call list. The numbers on the map match the list.' },
    'paper-panel': { w: 265, src: 'help/paper-panel.jpg', alt: 'The Paper call lists box warning that the lists are out of date', caption: 'The Paper call lists box tells you when the printed copies need updating.' },
  };

  // ------------------------------------------------------------------ content: FAQ
  const FAQ = [
    {
      cat: 'Your data and privacy',
      items: [
        {
          id: 'leaves', q: 'Does any of our information leave this computer?',
          a: `<p>Only what's needed to find addresses on the map. To put people on the map, the app sends postcodes to <b>postcodes.io</b>, a free UK postcode
            service. If a postcode isn't recognised, it sends the street and town to <b>OpenStreetMap</b>'s address search instead.
            The map pictures come from OpenStreetMap (or Esri for the satellite view), so those services can see which area you're looking at.</p>
            <p>Names, phone numbers, email addresses, statuses and notes are never sent anywhere. If you connect ChurchSuite, the app reads your list
            from ChurchSuite but never sends anything back.</p>`,
        },
        {
          id: 'stored', q: 'Where is everything kept?',
          a: `<p>In the <b>data</b> folder, next to the <b>Emergency Hub</b> shortcut. <i>contacts.json</i> holds everyone with their statuses and notes,
            <i>backups</i> has a copy taken before each upload (the last 30 are kept), <i>config.json</i> has a few technical settings, and <i>demo</i> holds the
            demo church. The <i>app</i> folder next to it is the program itself, which updates replace, so there's no need to back that up. The <i>tiles</i> folder is the stored street map, which you can clear in
            <a data-act="settings:look">Settings &rarr; Look and feel</a>.</p>`,
        },
        {
          id: 'backup', q: 'How should we back it up?',
          a: `<p>Copy the whole <b>data</b> folder somewhere safe, ideally an encrypted USB stick or another computer you trust. To restore it, close the black
            server window, copy the folder back and start the app again.</p>
            <p><b>Export CSV</b> in the menu also gives you a spreadsheet of everyone with their statuses, hub and notes. That's handy for checking things,
            but the file isn't encrypted, so delete it when you've finished with it.</p>`,
        },
        {
          id: 'encryption', q: 'Should we turn on encryption?',
          a: `<p>If you're recording anything sensitive, such as who is vulnerable, then yes. Encryption scrambles the files in the data folder (including the
            backups and your ChurchSuite details), so they're useless to anyone who gets hold of the computer or its drive.</p>
            <p>Once it's on, the app asks for the passphrase each time it starts, and locks itself if nobody uses it for a while (30 minutes unless you change it).
            You can also lock it straight away with <b>Lock now</b> in the menu. Turn it on in <a data-act="settings:data">Settings &rarr; Data &amp; privacy</a>.</p>`,
        },
        {
          id: 'forgot', q: 'What happens if we forget the passphrase?',
          a: `<p>Unfortunately there's no way back in. There's no reset and no back door, and the backups are encrypted with the same passphrase.
            That's why the app asks you to confirm you've thought about this before switching encryption on.</p>
            <p>Keep the passphrase in a password manager, or in a sealed envelope held by your data protection lead. If it's lost completely, you can rename the
            data folder and start again with a fresh import (the app will open in the demo, so turn that off first), but statuses, notes and hub choices
            would need adding again.</p>`,
        },
        {
          id: 'consent', q: 'Do we need people\'s permission to keep this information?',
          a: `<p>That's a question for your data protection lead, and the answer depends on what you record. The app can't give legal advice, but the
            <b>Data Protection Pack</b> in <a data-act="settings:data">Settings &rarr; Data &amp; privacy</a> is a good place to start. It explains what UK data
            protection law expects, and includes a paragraph for your privacy notice, a risk assessment outline and a confidentiality agreement for hub coordinators.</p>
            <p>Take particular care with notes about health or disability, which count as "special category" data and need extra justification.</p>`,
        },
        {
          id: 'network', q: 'Can other people use it from their own computers?',
          a: `<p>Not as it comes. The app only accepts connections from the computer it's running on, and that's deliberate. It's possible to open it up to other
            devices on your network by changing <i>host</i> to <i>0.0.0.0</i> in <i>data\\config.json</i>, but anyone on that network could then reach it, so turn on
            encryption first and think carefully about whether you need to.</p>
            <p>For most churches it works best with one or two people looking after it on one computer, and everyone else using the printed call lists.</p>`,
        },
        {
          id: 'demo-safe', q: 'Is the demo safe to show people?',
          a: `<p>Yes. Every name, street, postcode, phone number and email address in it is invented. The postcodes end in letters that real UK postcodes never use,
            the phone numbers come from ranges Ofcom keeps for TV and films, and the email addresses use example.com. The dots are scattered around real
            villages so the map looks realistic, but they aren't placed on anyone's actual house.</p>
            <p>If your real data is encrypted, it's locked as soon as the demo is turned on, so nobody watching can switch over without the passphrase. Without
            encryption, turning the demo off shows your real list straight away, so keep an eye on who's at the keyboard. You can also start the demo from the
            lock screen with <b>Show the demo instead</b>, without ever typing the passphrase in front of an audience.</p>`,
        },
      ],
    },
    {
      cat: 'Getting your contacts in',
      items: [
        {
          id: 'csv', q: 'What should our CSV file look like?',
          a: `<p>The first row should be column headings. The app looks for <i>First Name, Last Name, Address 1, Address 2, Town/City, County, Postcode, Country,
            Telephone, Mobile</i> and <i>Email</i>, and it's fairly relaxed about the exact wording, so <i>Surname</i>, <i>Street</i>, <i>Phone</i> or
            <i>Email Address</i> all work too. Only first and last name are essential, and any extra columns are ignored.</p>
            <p>Have a look at <i>contacts-template.csv</i> in the <i>app</i> folder for an example. Most church databases and spreadsheet programs can save a CSV file.</p>`,
        },
        {
          id: 'reupload', q: 'What happens when I upload a new list?',
          a: `<p>Each upload is treated as your complete, current list. New people are added, anyone who isn't in the file is removed, and changed details such as
            a new phone number are updated. Statuses, hub choices, notes and hand-placed pins all carry over to the matching people.</p>
            <p>Afterwards you'll see a report of exactly what changed, and every past report is kept under <a data-act="report">Changes report</a>.
            A copy of the data is saved in the backups folder before each upload, in case something goes wrong.</p>`,
        },
        {
          id: 'undo', q: 'I uploaded the wrong file. Can I undo it?',
          a: `<p>There's no undo button, but the app saves a copy of everything just before each upload, in the <i>backups</i> folder inside the data folder.
            The files are named with the date and time, like <i>contacts-20261101-101500-before-import.json</i>. To go back, close the black server window,
            copy the backup you want into the data folder, rename it to <i>contacts.json</i> (replacing the one there), and start the app again.
            Statuses, notes and hub choices come back exactly as they were at that moment.</p>`,
        },
        {
          id: 'matching', q: 'How does it know who\'s who between uploads?',
          a: `<p>People are matched by first name and last name. If two people share a name, their postcode or email address tells them apart.
            Someone who changes their surname is still matched, as long as their first name and either their email address or mobile number stay the same.</p>
            <p>If a person is matched wrongly, or their name changes in a way the app can't follow, they'll appear in the report as one person removed and another
            added. Their statuses and notes will need ticking again on the new entry.</p>`,
        },
        {
          id: 'churchsuite', q: 'How do I connect ChurchSuite?',
          a: `<p>Someone with Administrator access to ChurchSuite needs to turn on API access for a user who can only <i>view</i> the Address Book, then create a
            <b>Client ID</b> and <b>Client Secret</b> for that user. Paste both into <a data-act="settings:data">Settings &rarr; Data &amp; privacy</a> and click
            <b>Connect to ChurchSuite</b>.</p>
            <p>The app then shows your ChurchSuite tags. Tick the ones that should be included (anyone with any ticked tag is fetched), and use
            <b>Sync from ChurchSuite</b> in the menu whenever you want the latest list. The link only reads from ChurchSuite and never changes anything there.
            The secret is stored on this computer only.</p>`,
        },
        {
          id: 'sync-confirm', q: 'Why did a ChurchSuite sync ask me to confirm?',
          a: `<p>If a sync would remove a large part of your list (more than about 30%, and more than five people), the app stops and asks first. That usually means a
            tag has been changed or emptied in ChurchSuite, and it saves you losing everyone's statuses by accident. Check your tags, and only go ahead if the
            removals are what you expect.</p>`,
        },
        {
          id: 'how-often', q: 'How often should we update the list?',
          a: `<p>Whenever there have been noticeable changes, and certainly before you reprint the call lists. Every month or two suits most churches.
            The Paper call lists box on the left tells you when the printed copies no longer match what's in the app.</p>`,
        },
      ],
    },
    {
      cat: 'The map',
      items: [
        {
          id: 'colours', q: 'What do the dot colours mean?',
          a: `<p>Each dot takes the colour of the most important status of anyone living at that address. "Most important" follows the order in the legend on the
            left, which you can change in <a data-act="settings:status">Settings &rarr; Statuses</a> along with the colours. Grey means nobody there has a status.
            Hub coordinators have a ring round their dot.</p>`,
        },
        {
          id: 'clusters', q: 'What are the numbered circles?',
          a: `<p>When dots are close together they're gathered into a circle showing how many are inside. Click it to split it back into the separate households.
            If they're spread over a wider area, the map zooms in towards them instead. If you'd rather see every dot all the time, untick <b>Group nearby dots</b> under Map layers. Hub coordinators are never gathered up.</p>`,
        },
        {
          id: 'lines', q: 'What do the different lines mean?',
          a: `<p>A thick dark line runs from the central hub to each hub coordinator. Thinner coloured lines run from each hub coordinator to the people in their group,
            and a dashed line means you chose that hub by hand. If you use more than one grouping level, there's also a line from each hub coordinator to the
            hub coordinators in their group. The key is under <b>Map layers</b> on the left, where you can also hide the lines.</p>`,
        },
        {
          id: 'not-on-map', q: 'Why isn\'t someone on the map?',
          a: `<p>Usually their postcode is missing, mistyped or out of date. <a data-act="unmapped">Not on map</a> in the menu lists everyone who couldn't be
            placed, along with anyone whose position is only approximate. The best fix is to correct the address in your church database, so it's right on the
            next upload. For a quick fix, open their card and use <b>Place on map by hand</b>, then click where they live.</p>`,
        },
        {
          id: 'wrong-place', q: 'Someone is in the wrong place. How do I move them?',
          a: `<p>Open their card, click <b>Move pin</b> and then click the right spot on the map. A hand-placed pin is kept when you upload a new list. If you change
            your mind, <b>Use address again</b> on the card puts them back where their postcode says.</p>`,
        },
        {
          id: 'find', q: 'How do I find a person, or everyone in a particular area?',
          a: `<p>Type a name, street, town or postcode into <b>Find a person</b> on the left. To see everyone within a certain distance of somewhere, open
            <a data-act="table">Table view</a>, enter a postcode under <b>Near postcode</b>, choose a distance and click <b>Search area</b>. That's useful when, say,
            one road is flooded and you want to know who lives nearby.</p>`,
        },
        {
          id: 'offline', q: 'Does it work without the internet?',
          a: `<p>Yes, for the most part. Every part of the street map you look at is stored on this computer, so areas you've already viewed (at the zoom levels you viewed them)
            still show when the internet is down. It's worth browsing your area and zooming in on the streets you might need, to stock it up. The satellite view
            and looking up new postcodes do need the internet.</p>
            <p>If the computer itself is out of action, the printed call lists are your backup, which is why it's worth keeping them current.</p>`,
        },
        {
          id: 'map-style', q: 'Can I see a satellite view, or a dark map?',
          a: `<p>Use the layers button in the top right corner of the map to switch between the street map and satellite. <b>Dark mode</b> (or <b>Light mode</b>) in the menu
            switches between the two. In <a data-act="settings:look">Settings &rarr; Look and feel</a> you can keep the map light while the rest goes dark,
            or the other way round.</p>`,
        },
      ],
    },
    {
      cat: 'Hubs and call lists',
      items: [
        {
          id: 'assign', q: 'How does it decide who goes in which hub?',
          a: `<p>Everyone joins the hub coordinator who lives nearest to them in a straight line. The app doesn't know about roads, rivers or who gets on with whom,
            so it's worth checking the result in <a data-act="hubs">Hub groups</a>. To choose a different hub for someone, use the drop-down list on their card.
            That choice is kept, even when you upload a new list, until you set it back to <b>Automatic</b>.</p>`,
        },
        {
          id: 'group-size', q: 'How many people should each hub coordinator have?',
          a: `<p>There's no fixed rule, but think about how many calls one person can realistically make in a hurry, possibly with a poor signal. Somewhere around
            eight to fifteen households is manageable for most people. If a group is much bigger, add another hub coordinator in that area and the people
            nearest to them will move across automatically.</p>`,
        },
        {
          id: 'levels', q: 'What are grouping levels?',
          a: `<p>For a larger church, one layer of hub coordinators can mean too many calls for the central hub. With more than one level, a hub coordinator's group can
            include other hub coordinators, who each have a group of their own. For example, Anna (level 1) might have Ben in her group, and Ben (level 2) looks
            after the people near him. Ben's people are only on Ben's list, and Ben reports to Anna rather than straight to the church.</p>
            <p>Set the number of levels in <a data-act="settings:org">Settings &rarr; Organisation details</a>, then set each hub coordinator's level on their card or
            in Table view.</p>`,
        },
        {
          id: 'one-hub', q: 'Can I print just one hub\'s list?',
          a: `<p>Yes. In <a data-act="hubs">Hub groups</a>, each hub has its own <b>Print</b> button. That's handy when only one group has changed: reprint it,
            hand it over, then click <b>Confirm call lists printed</b> as usual, as long as nobody else's list changed too.</p>`,
        },
        {
          id: 'printed', q: 'What\'s on a printed call list?',
          a: `<p>Each hub starts on a new page with the hub coordinator's name, phone number and address, and who they report back to with their contact details.
            Then there's a map of the group with numbered homes (unless you've unticked <b>Include maps</b>), followed by a table of everyone to ring with their phone
            numbers, address, statuses and notes, and two boxes to tick: <i>Contacted</i> and <i>OK?</i></p>
            <p>Anyone who isn't in a hub, usually because they're not on the map, is printed on a separate page at the end so they don't get missed.</p>`,
        },
        {
          id: 'confirm', q: 'What does "Confirm call lists printed" do?',
          a: `<p>It records today as the date the paper lists were printed and handed out, and remembers what was on them. Printing on its own doesn't change the date,
            because you might print a test copy or the printer might jam, so click Confirm once the copies are actually out there.</p>`,
        },
        {
          id: 'out-of-date', q: 'Why does it say the call lists are out of date?',
          a: `<p>Something that appears on the printed lists has changed since you last confirmed them. That could be a name, phone number, address, status or note, a
            person joining or leaving, someone moving to a different hub, or a change to the central hub's contact details. Reprint the lists, hand them out, and
            click <b>Confirm call lists printed</b> again to clear the warning.</p>`,
        },
        {
          id: 'print-maps', q: 'The maps on the printed lists are missing or blank.',
          a: `<p>First check that <b>Include maps</b> is ticked in Hub groups. The maps are drawn from the stored street map, so an area you've never looked at needs the
            internet the first time it's printed. After that it's stored and will print offline too.</p>`,
        },
        {
          id: 'away', q: 'What if a hub coordinator is away or can\'t be reached?',
          a: `<p>The app doesn't track deputies, so it's worth agreeing a back-up person for each hub coordinator and giving them a copy of the same list. A note on the
            hub coordinator's card is a handy place to record who that is.</p>`,
        },
      ],
    },
    {
      cat: 'Settings and appearance',
      items: [
        {
          id: 'own-statuses', q: 'Can we use our own statuses?',
          a: `<p>Yes. In <a data-act="settings:status">Settings &rarr; Statuses</a> you can rename, recolour, reorder, add and remove statuses, up to 15 of them.
            The order matters, because a dot takes the colour of the highest status in the list. Removing a status takes it off everyone who had it.
            <b>Hub Coordinator</b> can be renamed but not removed, because the hub network depends on it.</p>`,
        },
        {
          id: 'look', q: 'Can I change the colours?',
          a: `<p>In <a data-act="settings:look">Settings &rarr; Look and feel</a> you can choose an accent colour for the title bar and headings, and change the dot size,
            the lines and the marker for the central hub (a star, your logo or a picture of your choice). <b>Reset look and feel</b> puts all of those back as
            they started, without touching your statuses or organisation details.</p>`,
        },
      ],
    },
    {
      cat: 'Updates',
      items: [
        {
          id: 'updates', q: 'How do I get new versions?',
          a: `<p>The app checks once a day whether a new version has been published, and when there is one, an orange dot appears on the Menu button and next to Settings.
            Go to <a data-act="settings:about">Settings &rarr; About &amp; updates</a> to read what's new and click <b>Install</b>. It downloads the new version,
            restarts itself and reloads the page, which takes less than a minute. You can also click <b>Check now</b> at any time, or turn the daily check off.</p>`,
        },
        {
          id: 'update-safe', q: 'Will an update touch our data?',
          a: `<p>No. An update only replaces the program's own files. Your <i>data</i> folder, with all your settings, and your passphrase are left alone.
            Before installing, the app checks the download against a fingerprint published with the release and refuses it if they don't match, and it keeps
            the version you had so you can go back to it from the same page. If a new version ever needs to change how the data is stored, it makes a backup first.</p>`,
        },
        {
          id: 'update-check', q: 'What does checking for updates send to the internet?',
          a: `<p>Only a request to GitHub, the site where new versions are published, asking for the latest one. GitHub sees your internet address, the same as
            visiting any website, but nothing about your church or your contacts. If you'd rather it didn't check, untick the daily check in
            <a data-act="settings:about">Settings &rarr; About &amp; updates</a> and click <b>Check now</b> when you want to.</p>`,
        },
      ],
    },
    {
      cat: 'Troubleshooting',
      items: [
        {
          id: 'start', q: 'Nothing happens when I double-click Emergency Hub.',
          a: `<p>First, make sure you've unzipped the download rather than opening it from inside the zip file, and that the <b>Emergency Hub</b> shortcut
            is still next to the <i>app</i> folder. If Windows shows a blue "Windows protected your PC" box, click <b>More info</b> and then <b>Run anyway</b>;
            it does this for programs downloaded from the internet that aren't from a big software company. You can avoid it next time by right-clicking the zip,
            choosing <b>Properties</b>, ticking <b>Unblock</b> and then unzipping.</p>
            <p>The download comes with its own copy of Python in <i>app\\python</i>, so there's nothing else to install. If the black window says Python can't be found,
            download the latest Windows zip again, unzip it, and copy your <i>data</i> folder across from the old copy. If the window stays open but the browser
            doesn't appear, go to <b>http://127.0.0.1:8765</b> in your browser.</p>`,
        },
        {
          id: 'shortcut', q: 'Can I put Emergency Hub on the desktop?',
          a: `<p>Yes. Once the app has been started at least once, right-click the <b>Emergency Hub</b> shortcut, choose <b>Copy</b>, and paste it on the desktop
            or wherever suits you. If you ever move the whole Emergency Hub Coordinator folder, start it once from inside the folder and copies of the shortcut
            will work again.</p>`,
        },
        {
          id: 'cant-connect', q: 'The browser says it can\'t connect.',
          a: `<p>The black server window has to stay open while you use the app, because that's what runs it. If you've closed it, double-click
            <b>Emergency Hub</b> again and refresh the page.</p>`,
        },
        {
          id: 'older-version', q: 'It says the server is running an older version.',
          a: `<p>That happens when the app's files have been replaced while the old version was still running, for example after copying in new files by hand.
            Close the black server window, double-click <b>Emergency Hub</b> again, then refresh the page. Updates installed from
            <a data-act="settings:about">Settings &rarr; About &amp; updates</a> restart the app for you, so this shouldn't happen with those.</p>`,
        },
        {
          id: 'greyed-out', q: 'The upload button is greyed out.',
          a: `<p>You're in the demo, which can't load real contacts. Turn it off in <a data-act="settings:data">Settings &rarr; Data &amp; privacy</a> and the button
            comes back. ChurchSuite and encryption are switched off in the demo for the same reason.</p>`,
        },
        {
          id: 'locked', q: 'It keeps asking for the passphrase.',
          a: `<p>When encryption is on, the app locks itself if it hasn't been used for a while, which protects the data if the computer is left unattended.
            You can change how long it waits, or turn the automatic lock off, in <a data-act="settings:data">Settings &rarr; Data &amp; privacy</a>.</p>`,
        },
      ],
    },
  ];

  // ------------------------------------------------------------------ rendering
  const $ = (id) => document.getElementById(id);
  let helpTab = 'quick';

  const figHtml = (key, forPrint) => {
    const f = FIGS[key];
    if (!f) return '';
    const size = f.w ? ` style="max-width:${f.w}px"` : '';
    return `<figure class="help-fig${key === 'overview' ? ' help-fig-wide' : ''}"${size}><img src="${f.src}" alt="${f.alt}" ${forPrint ? '' : 'loading="lazy" tabindex="0" title="Click to enlarge"'}>
      <figcaption>${f.caption}</figcaption></figure>`;
  };
  const fill = (html, forPrint) => html.replace(/\{\{fig:([a-z-]+)\}\}/g, (_, k) => figHtml(k, forPrint));

  function quickStartHtml() {
    return `<div class="help-qs">
      <div class="help-intro">${QUICK_START_INTRO}</div>
      <ol class="help-toc">${QUICK_START.map((s) => `<li><a data-step="${s.id}">${s.title}</a></li>`).join('')}</ol>
      ${QUICK_START.map((s, i) => `<article class="help-step" id="help-step-${s.id}">
        <div class="help-num" aria-hidden="true">${i + 1}</div>
        <div class="help-step-body"><h3><span class="sr-only">Step ${i + 1}: </span>${s.title}</h3>${fill(s.html, false)}</div>
      </article>`).join('')}
      <div class="help-outro">${QUICK_START_OUTRO}</div>
    </div>`;
  }

  function faqHtml() {
    return `<div class="help-faq">
      <div class="help-search"><input type="search" id="helpSearch" placeholder="Search the questions, e.g. passphrase, postcode, print" autocomplete="off" aria-label="Search the questions"></div>
      <p class="help-none" id="helpNone" hidden>Nothing matches that. Try a shorter or different word, or browse the questions below.</p>
      ${FAQ.map((c) => `<section class="help-cat"><h3>${c.cat}</h3>
        ${c.items.map((it) => `<details class="help-q" id="faq-${it.id}"><summary>${it.q}</summary><div class="help-a">${it.a}</div></details>`).join('')}
      </section>`).join('')}
    </div>`;
  }

  function render() {
    const tabs = [['quick', 'Quick start'], ['faq', 'FAQ']];
    return `<div class="set-tabs help-tabs" role="tablist">${tabs.map(([k, l]) => `<button type="button" role="tab" class="set-tab-btn${helpTab === k ? ' active' : ''}" data-help-tab="${k}" aria-selected="${helpTab === k}">${l}</button>`).join('')}</div>
      <div class="help-panel" data-help-panel="quick" ${helpTab === 'quick' ? '' : 'hidden'}>${quickStartHtml()}</div>
      <div class="help-panel" data-help-panel="faq" ${helpTab === 'faq' ? '' : 'hidden'}>${faqHtml()}</div>`;
  }

  function setTab(tab) {
    helpTab = tab;
    const body = $('modalBody');
    body.querySelectorAll('[data-help-tab]').forEach((b) => { const on = b.dataset.helpTab === tab; b.classList.toggle('active', on); b.setAttribute('aria-selected', on); });
    body.querySelectorAll('[data-help-panel]').forEach((p) => { p.hidden = p.dataset.helpPanel !== tab; });
    body.scrollTop = 0;
  }

  function scrollToEl(el) {
    const body = $('modalBody');
    let top = body.querySelector('.help-tabs').offsetHeight;
    const search = el.closest('.help-faq') && body.querySelector('.help-search');
    if (search) top += search.offsetHeight;
    body.scrollTop += el.getBoundingClientRect().top - body.getBoundingClientRect().top - top - 10;
  }

  function openFaq(id) {
    setTab('faq');
    const d = $('faq-' + id);
    if (!d) return;
    d.open = true;
    d.classList.add('flash');
    setTimeout(() => d.classList.remove('flash'), 1600);
    requestAnimationFrame(() => scrollToEl(d));
  }

  const ACTIONS = {
    'settings:org': () => { settingsTab = 'org'; showSettings(); },
    'settings:status': () => { settingsTab = 'status'; showSettings(); },
    'settings:data': () => { settingsTab = 'data'; showSettings(); },
    'settings:look': () => { settingsTab = 'look'; showSettings(); },
    'settings:about': () => { settingsTab = 'about'; showSettings(); },
    hubs: () => showHubGroups(),
    unmapped: () => showUnmapped(),
    table: () => showTable(),
    report: () => showReports(),
  };

  function zoomImage(img) {
    const z = document.createElement('div');
    z.className = 'help-zoom';
    z.innerHTML = `<img src="${img.getAttribute('src')}" alt="${img.alt}"><span class="help-zoom-hint">Click anywhere or press Esc to close</span>`;
    const close = (e) => { if (e && e.type === 'keydown' && e.key !== 'Escape') return; if (e) e.stopPropagation(); z.remove(); document.removeEventListener('keydown', close, true); };
    z.addEventListener('click', () => close());
    document.addEventListener('keydown', close, true);
    document.body.appendChild(z);
  }

  function openHelp(tab) {
    if (tab) helpTab = tab;
    openModal('Help', render(),
      '<button class="btn small" id="btnPrintQs" title="Print the quick start guide, with pictures">&#128438; Print the quick start guide</button>', 'helpmodal');
    try { localStorage.setItem('ehc.helpSeen', '1'); } catch (e) { /* ignore */ }
    $('btnMenu').classList.remove('pulse');
    const body = $('modalBody');
    body.querySelectorAll('[data-help-tab]').forEach((b) => b.addEventListener('click', () => setTab(b.dataset.helpTab)));
    body.addEventListener('click', (e) => {
      const a = e.target.closest('a[data-faq], a[data-act], a[data-step], a[data-tab]');
      if (a) {
        e.preventDefault();
        if (a.dataset.faq) openFaq(a.dataset.faq);
        else if (a.dataset.tab) setTab(a.dataset.tab);
        else if (a.dataset.step) scrollToEl($('help-step-' + a.dataset.step));
        else if (ACTIONS[a.dataset.act]) { closeModal(); ACTIONS[a.dataset.act](); }
        return;
      }
      const img = e.target.closest('.help-fig img');
      if (img) zoomImage(img);
    });
    body.addEventListener('keydown', (e) => {
      const img = e.target.closest && e.target.closest('.help-fig img');
      if (img && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); zoomImage(img); }
    });
    // every link gets an href so it looks and behaves like a link (keyboard focus included)
    body.querySelectorAll('a[data-faq], a[data-act], a[data-step], a[data-tab]').forEach((a) => a.setAttribute('href', '#'));
    const search = $('helpSearch');
    search.addEventListener('input', () => filterFaq(search.value));
    $('btnPrintQs').addEventListener('click', printQuickStart);
  }

  function filterFaq(q) {
    const words = q.toLowerCase().split(/\s+/).filter(Boolean);
    let shown = 0;
    $('modalBody').querySelectorAll('.help-cat').forEach((cat) => {
      let any = false;
      cat.querySelectorAll('.help-q').forEach((d) => {
        const text = d.textContent.toLowerCase();
        const hit = words.every((w) => text.includes(w));
        d.hidden = !hit;
        d.open = words.length > 0 && hit;
        if (hit) { any = true; shown++; }
      });
      cat.hidden = !any;
    });
    $('helpNone').hidden = shown > 0;
  }

  // ------------------------------------------------------------------ printing the quick start guide
  function printQuickStart() {
    const st = (typeof SETTINGS !== 'undefined' && SETTINGS) || {};
    const demo = typeof STATE !== 'undefined' && STATE && STATE.demo;
    const org = !demo && st.org_name ? st.org_name : '';
    const stripLinks = (html) => html.replace(/<a [^>]*>/g, '').replace(/<\/a>/g, '');
    const area = $('printArea');
    area.innerHTML = `<div class="qs-print">
      <header class="qs-head"><div><div class="qs-kicker">Emergency Hub Coordinator${org ? ` &middot; ${org.replace(/[<>&]/g, '')}` : ''}</div>
        <h1>Quick start guide</h1></div></header>
      <div class="qs-intro">${stripLinks(QUICK_START_INTRO)}</div>
      <ol class="qs-toc">${QUICK_START.map((s) => `<li>${s.title}</li>`).join('')}</ol>
      ${QUICK_START.map((s, i) => `<section class="qs-step"><h2><span class="qs-num">${i + 1}</span>${s.title}</h2>${stripLinks(fill(s.html, true))}</section>`).join('')}
      <div class="qs-outro">${stripLinks(QUICK_START_OUTRO).replace('The FAQ', 'The FAQ in the app (Menu, then Help and quick start)')}</div>
    </div>`;
    const theme = document.documentElement.dataset.theme;
    document.documentElement.dataset.theme = 'light';
    document.body.classList.add('print-help');
    const done = () => {
      document.body.classList.remove('print-help');
      document.documentElement.dataset.theme = theme;
      area.innerHTML = '';
      window.removeEventListener('afterprint', done);
    };
    window.addEventListener('afterprint', done);
    const imgs = [...area.querySelectorAll('img')];
    Promise.all(imgs.map((im) => (im.complete ? 1 : new Promise((r) => { im.onload = r; im.onerror = r; }))))
      .then(() => setTimeout(() => window.print(), 50));
  }

  // ------------------------------------------------------------------ the button
  const btn = $('btnHelp');
  btn.addEventListener('click', () => openHelp());
  const eh = $('btnEmptyHelp');
  if (eh) eh.addEventListener('click', () => openHelp('quick'));
  try { if (!localStorage.getItem('ehc.helpSeen')) $('btnMenu').classList.add('pulse'); } catch (e) { /* ignore */ }
  window.EHCHelp = { open: openHelp, openFaq: (id) => { openHelp('faq'); openFaq(id); }, printQuickStart };
}());
