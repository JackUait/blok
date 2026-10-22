/**
 * Notion's time zone list, all 568 rows (research/37 §1, read in full).
 * Notion shows labels, not ids: each id here is inferred from the label, the
 * ASCII id order and the offset. Europe/Kiev is the "Kyiv" row: it sorts before
 * Kirov, and Europe/Kyiv is not listed. Grouped by region to keep the bundle
 * small; read as `region/name`.
 */
const GROUPS: Record<string, string[]> = {
  Africa: [
    'Abidjan Accra Addis_Ababa Algiers Asmara Asmera Bamako Bangui Banjul Bissau Blantyre Brazzaville Bujumbura',
    'Cairo Casablanca Ceuta Conakry Dakar Dar_es_Salaam Djibouti Douala El_Aaiun Freetown Gaborone Harare',
    'Johannesburg Juba Kampala Khartoum Kigali Kinshasa Lagos Libreville Lome Luanda Lubumbashi Lusaka Malabo',
    'Maputo Maseru Mbabane Mogadishu Monrovia Nairobi Ndjamena Niamey Nouakchott Ouagadougou Porto-Novo Sao_Tome',
    'Timbuktu Tripoli Tunis Windhoek',
  ],
  America: [
    'Adak Anchorage Anguilla Antigua Araguaina Argentina/Buenos_Aires Argentina/Catamarca',
    'Argentina/ComodRivadavia Argentina/Cordoba Argentina/Jujuy Argentina/La_Rioja Argentina/Mendoza',
    'Argentina/Rio_Gallegos Argentina/Salta Argentina/San_Juan Argentina/San_Luis Argentina/Tucuman',
    'Argentina/Ushuaia Aruba Asuncion Atikokan Atka Bahia Bahia_Banderas Barbados Belem Belize Blanc-Sablon',
    'Boa_Vista Bogota Boise Buenos_Aires Cambridge_Bay Campo_Grande Cancun Caracas Cayenne Cayman Chicago',
    'Chihuahua Ciudad_Juarez Coral_Harbour Costa_Rica Creston Cuiaba Curacao Danmarkshavn Dawson Dawson_Creek',
    'Denver Detroit Dominica Edmonton Eirunepe El_Salvador Ensenada Fort_Nelson Fort_Wayne Fortaleza Glace_Bay',
    'Godthab Goose_Bay Grand_Turk Grenada Guadeloupe Guatemala Guayaquil Guyana Halifax Havana Hermosillo',
    'Indiana/Indianapolis Indiana/Knox Indiana/Marengo Indiana/Petersburg Indiana/Tell_City Indiana/Vevay',
    'Indiana/Vincennes Indiana/Winamac Inuvik Iqaluit Jamaica Juneau Kentucky/Louisville Kentucky/Monticello',
    'Kralendijk La_Paz Lima Los_Angeles Louisville Lower_Princes Maceio Managua Manaus Marigot Martinique',
    'Matamoros Mazatlan Menominee Merida Metlakatla Mexico_City Miquelon Moncton Monterrey Montevideo Montreal',
    'Montserrat Nassau New_York Nipigon Nome Noronha North_Dakota/Beulah North_Dakota/Center',
    'North_Dakota/New_Salem Nuuk Ojinaga Panama Pangnirtung Paramaribo Phoenix Port-au-Prince Port_of_Spain',
    'Porto_Acre Porto_Velho Puerto_Rico Punta_Arenas Rainy_River Rankin_Inlet Recife Regina Resolute Rio_Branco',
    'Rosario Santa_Isabel Santarem Santiago Santo_Domingo Sao_Paulo Scoresbysund Shiprock Sitka St_Barthelemy',
    'St_Johns St_Kitts St_Lucia St_Thomas St_Vincent Swift_Current Tegucigalpa Thule Thunder_Bay Tijuana Toronto',
    'Tortola Vancouver Virgin Whitehorse Winnipeg Yakutat Yellowknife',
  ],
  Antarctica: [
    'Casey Davis DumontDUrville Macquarie Mawson McMurdo Palmer Rothera South_Pole Syowa Troll Vostok',
  ],
  Arctic: [
    'Longyearbyen',
  ],
  Asia: [
    'Aden Almaty Amman Anadyr Aqtau Aqtobe Ashgabat Ashkhabad Atyrau Baghdad Bahrain Baku Bangkok Barnaul Beirut',
    'Bishkek Brunei Calcutta Chita Choibalsan Chongqing Chungking Colombo Dacca Damascus Dhaka Dili Dubai',
    'Dushanbe Famagusta Gaza Harbin Hebron Ho_Chi_Minh Hong_Kong Hovd Irkutsk Istanbul Jakarta Jayapura Jerusalem',
    'Kabul Kamchatka Karachi Kashgar Kathmandu Katmandu Khandyga Kolkata Krasnoyarsk Kuala_Lumpur Kuching Kuwait',
    'Macao Macau Magadan Makassar Manila Muscat Nicosia Novokuznetsk Novosibirsk Omsk Oral Phnom_Penh Pontianak',
    'Pyongyang Qatar Qostanay Qyzylorda Rangoon Riyadh Saigon Sakhalin Samarkand Seoul Shanghai Singapore',
    'Srednekolymsk Taipei Tashkent Tbilisi Tehran Tel_Aviv Thimbu Thimphu Tokyo Tomsk Ujung_Pandang Ulaanbaatar',
    'Ulan_Bator Urumqi Ust-Nera Vientiane Vladivostok Yakutsk Yangon Yekaterinburg Yerevan',
  ],
  Atlantic: [
    'Azores Bermuda Canary Cape_Verde Faeroe Faroe Jan_Mayen Madeira Reykjavik South_Georgia St_Helena Stanley',
  ],
  Australia: [
    'ACT Adelaide Brisbane Broken_Hill Canberra Currie Darwin Eucla Hobart LHI Lindeman Lord_Howe Melbourne NSW',
    'North Perth Queensland South Sydney Tasmania Victoria West Yancowinna',
  ],
  Brazil: [
    'Acre DeNoronha East West',
  ],
  '': [
    'CET Cuba EET EST Egypt Eire GB GB-Eire HST Hongkong Iceland Iran Israel Japan Kwajalein Libya MET MST NZ',
    'NZ-CHAT Navajo PRC Poland Portugal ROC ROK Turkey UTC W-SU WET',
  ],
  Canada: [
    'Atlantic Central Eastern Mountain Newfoundland Pacific Saskatchewan Yukon',
  ],
  Chile: [
    'Continental EasterIsland',
  ],
  Etc: [
    'GMT GMT+0 GMT+1 GMT+10 GMT+11 GMT+12 GMT+2 GMT+3 GMT+4 GMT+5 GMT+6 GMT+7 GMT+8 GMT+9 GMT-1 GMT-10 GMT-11',
    'GMT-12 GMT-13 GMT-14 GMT-2 GMT-3 GMT-4 GMT-5 GMT-6 GMT-7 GMT-8 GMT-9 Greenwich UCT Universal Zulu',
  ],
  Europe: [
    'Amsterdam Andorra Astrakhan Athens Belfast Belgrade Berlin Bratislava Brussels Bucharest Budapest Busingen',
    'Chisinau Copenhagen Dublin Gibraltar Guernsey Helsinki Isle_of_Man Jersey Kaliningrad Kiev Kirov Lisbon',
    'Ljubljana London Luxembourg Madrid Malta Mariehamn Minsk Monaco Moscow Oslo Paris Podgorica Prague Riga Rome',
    'Samara San_Marino Sarajevo Saratov Simferopol Skopje Sofia Stockholm Tallinn Tirane Tiraspol Ulyanovsk',
    'Uzhgorod Vaduz Vatican Vienna Vilnius Volgograd Warsaw Zagreb Zaporozhye Zurich',
  ],
  Indian: [
    'Antananarivo Chagos Christmas Cocos Comoro Kerguelen Mahe Maldives Mauritius Mayotte Reunion',
  ],
  Mexico: [
    'BajaNorte BajaSur General',
  ],
  Pacific: [
    'Apia Auckland Bougainville Chatham Chuuk Easter Efate Enderbury Fakaofo Fiji Funafuti Galapagos Gambier',
    'Guadalcanal Guam Honolulu Johnston Kanton Kiritimati Kosrae Majuro Marquesas Midway Nauru Niue Norfolk',
    'Noumea Pago_Pago Palau Pitcairn Pohnpei Ponape Port_Moresby Rarotonga Saipan Samoa Tahiti Tarawa Tongatapu',
    'Truk Wake Wallis Yap',
  ],
  US: [
    'Alaska Aleutian Arizona Central East-Indiana Eastern Hawaii Indiana-Starke Michigan Mountain Pacific',
  ],
};

/** Every name, in code-unit order of the full id: Notion's tail is US/Pacific, UTC, W-SU, WET. */
export const TIME_ZONE_NAMES: readonly string[] = Object.entries(GROUPS)
  .flatMap(([region, lines]) => lines.join(' ').split(' ').map((name) => (region === '' ? name : `${region}/${name}`)))
  // Plain sort() compares UTF-16 code units, which is the order wanted.
  .sort();
