export interface DistrictInfo {
  name: string;
  upazilas: string[];
}

export interface DivisionInfo {
  name: string;
  districts: DistrictInfo[];
}

export const BANGLADESH_DIVISIONS: DivisionInfo[] = [
  {
    name: 'Dhaka',
    districts: [
      {
        name: 'Dhaka',
        upazilas: ['Dhanmondi', 'Gulshan', 'Mirpur', 'Uttara', 'Mohammadpur', 'Tejgaon', 'Badda', 'Khilgaon', 'Motijheel', 'Savar', 'Dhamrai', 'Keraniganj', 'Nawabganj', 'Dohar']
      },
      {
        name: 'Gazipur',
        upazilas: ['Gazipur Sadar', 'Kaliakair', 'Kapasia', 'Sreepur', 'Kaliganj', 'Tongi']
      },
      {
        name: 'Narayanganj',
        upazilas: ['Narayanganj Sadar', 'Bandar', 'Rupganj', 'Sonargaon', 'Araihazar', 'Siddhirganj']
      },
      {
        name: 'Tangail',
        upazilas: ['Tangail Sadar', 'Mirzapur', 'Gopalpur', 'Kalihati', 'Madhupur', 'Ghatail', 'Sakhipur', 'Basail']
      },
      {
        name: 'Faridpur',
        upazilas: ['Faridpur Sadar', 'Boalmari', 'Bhanga', 'Madhukhali', 'Nagarkanda', 'Sadarpur']
      },
      {
        name: 'Manikganj',
        upazilas: ['Manikganj Sadar', 'Saturia', 'Singair', 'Harirampur', 'Ghior', 'Shibalaya', 'Daulatpur']
      },
      {
        name: 'Munshiganj',
        upazilas: ['Munshiganj Sadar', 'Sreenagar', 'Sirajdikhan', 'Lohajang', 'Tongibari', 'Gazaria']
      },
      {
        name: 'Kishoreganj',
        upazilas: ['Kishoreganj Sadar', 'Bhairab', 'Bajitpur', 'Katiadi', 'Karimganj', 'Nikli', 'Pakundia']
      },
      {
        name: 'Narsingdi',
        upazilas: ['Narsingdi Sadar', 'Palash', 'Shibpur', 'Belabo', 'Raipura', 'Monohardi']
      },
      {
        name: 'Gopalganj',
        upazilas: ['Gopalganj Sadar', 'Kashiani', 'Kotalipara', 'Muksudpur', 'Tungipara']
      },
      {
        name: 'Madaripur',
        upazilas: ['Madaripur Sadar', 'Kalkini', 'Rajoir', 'Shibchar']
      },
      {
        name: 'Rajbari',
        upazilas: ['Rajbari Sadar', 'Goalanda', 'Pangsha', 'Baliakandi', 'Kalukhali']
      },
      {
        name: 'Shariatpur',
        upazilas: ['Shariatpur Sadar', 'Damudya', 'Naria', 'Janjira', 'Bhedarganj', 'Gosairhat']
      }
    ]
  },
  {
    name: 'Chattogram',
    districts: [
      {
        name: 'Chattogram',
        upazilas: ['Chattogram Sadar', 'Pahartali', 'Kotwali', 'Panchlaish', 'Double Mooring', 'Sitakunda', 'Mirsharai', 'Hathazari', 'Patiya', 'Raozan', 'Rangunia', 'Anwara', 'Boalkhali', 'Chandanaish', 'Banshkhali', 'Lohagara', 'Satkania', 'Sandwip']
      },
      {
        name: 'Cox\'s Bazar',
        upazilas: ['Cox\'s Bazar Sadar', 'Chakaria', 'Teknaf', 'Ukhiya', 'Ramu', 'Kutubdia', 'Maheshkhali', 'Pekua']
      },
      {
        name: 'Cumilla',
        upazilas: ['Cumilla Adarsha Sadar', 'Cumilla Sadar Dakshin', 'Barura', 'Brahmanpara', 'Burichang', 'Chandina', 'Chauddagram', 'Daudkandi', 'Debidwar', 'Homna', 'Laksam', 'Muradnagar', 'Nangalkot', 'Titas', 'Meghna']
      },
      {
        name: 'Brahmanbaria',
        upazilas: ['Brahmanbaria Sadar', 'Kasba', 'Nasirnagar', 'Nabinagar', 'Bancharampur', 'Sarail', 'Ashuganj', 'Akhaura', 'Bijoynagar']
      },
      {
        name: 'Chandpur',
        upazilas: ['Chandpur Sadar', 'Faridganj', 'Haimchar', 'Haziganj', 'Kachua', 'Matlab Dakshin', 'Matlab Uttar', 'Shahrasti']
      },
      {
        name: 'Noakhali',
        upazilas: ['Noakhali Sadar', 'Begumganj', 'Chatkhil', 'Companiganj', 'Hatiya', 'Senbagh', 'Subarnachar', 'Kabirhat']
      },
      {
        name: 'Feni',
        upazilas: ['Feni Sadar', 'Chhagalnaiya', 'Daganbhuiyan', 'Parshuram', 'Fulgazi', 'Sonagazi']
      },
      {
        name: 'Lakshmipur',
        upazilas: ['Lakshmipur Sadar', 'Raipur', 'Ramganj', 'Ramgati', 'Kamalnagar']
      },
      {
        name: 'Bandarban',
        upazilas: ['Bandarban Sadar', 'Ruma', 'Thanchi', 'Rowangchhari', 'Lama', 'Alikadam', 'Naikhongchhari']
      },
      {
        name: 'Khagrachhari',
        upazilas: ['Khagrachhari Sadar', 'Dighinala', 'Panchhari', 'Mahalchhari', 'Matiranga', 'Manikchhari', 'Ramgarh', 'Lakshmichhari']
      },
      {
        name: 'Rangamati',
        upazilas: ['Rangamati Sadar', 'Baghaichhari', 'Barkal', 'Kaptai', 'Juraichhari', 'Langadu', 'Naniarchar', 'Rajasthali', 'Belaichhari']
      }
    ]
  },
  {
    name: 'Rajshahi',
    districts: [
      {
        name: 'Rajshahi',
        upazilas: ['Boalia', 'Motihar', 'Rajpara', 'Shah Makhdum', 'Godagari', 'Tanore', 'Mohanpur', 'Bagmara', 'Durgapur', 'Puthia', 'Charghat', 'Bagha', 'Paba']
      },
      {
        name: 'Bogura',
        upazilas: ['Bogura Sadar', 'Adamdighi', 'Dhunat', 'Dhupchanchia', 'Gabtali', 'Kahaloo', 'Nandigram', 'Sariakandi', 'Shajahanpur', 'Sherpur', 'Shibganj', 'Sonatala']
      },
      {
        name: 'Pabna',
        upazilas: ['Pabna Sadar', 'Atgharia', 'Bera', 'Bhangura', 'Chatmohar', 'Faridpur', 'Ishwardi', 'Santhia', 'Sujanagar']
      },
      {
        name: 'Sirajganj',
        upazilas: ['Sirajganj Sadar', 'Belkuchi', 'Chauhali', 'Kamarkhanda', 'Kazipur', 'Raiganj', 'Shahjadpur', 'Tarash', 'Ullahpara']
      },
      {
        name: 'Naogaon',
        upazilas: ['Naogaon Sadar', 'Atrai', 'Badalgachhi', 'Dhamoirhat', 'Manda', 'Mohadevpur', 'Niamatpur', 'Patnitala', 'Porsha', 'Raninagar', 'Sapahar']
      },
      {
        name: 'Natore',
        upazilas: ['Natore Sadar', 'Baraigram', 'Gurudaspur', 'Lalpur', 'Singra', 'Bagatipara', 'Naldanga']
      },
      {
        name: 'Chapai Nawabganj',
        upazilas: ['Chapai Nawabganj Sadar', 'Gomastapur', 'Nachole', 'Bholahat', 'Shibganj']
      },
      {
        name: 'Joypurhat',
        upazilas: ['Joypurhat Sadar', 'Akkelpur', 'Kalai', 'Khetlal', 'Panchbibi']
      }
    ]
  },
  {
    name: 'Khulna',
    districts: [
      {
        name: 'Khulna',
        upazilas: ['Khulna Sadar', 'Sonadanga', 'Khalishpur', 'Daulatpur', 'Batiaghata', 'Dacope', 'Dumuria', 'Dighalia', 'Koyra', 'Paikgachha', 'Phultala', 'Rupsha', 'Terokhada']
      },
      {
        name: 'Jashore',
        upazilas: ['Jashore Sadar', 'Abhaynagar', 'Bagherpara', 'Chaugachha', 'Jhikargachha', 'Keshabpur', 'Manirampur', 'Sharsha']
      },
      {
        name: 'Kushtia',
        upazilas: ['Kushtia Sadar', 'Kumarkhali', 'Daulatpur', 'Mirpur', 'Bheramara', 'Khoksa']
      },
      {
        name: 'Satkhira',
        upazilas: ['Satkhira Sadar', 'Assasuni', 'Debhata', 'Kalaroa', 'Kaliganj', 'Shyamnagar', 'Tala']
      },
      {
        name: 'Bagerhat',
        upazilas: ['Bagerhat Sadar', 'Chitalmari', 'Fakirhat', 'Kachua', 'Mollahat', 'Mongla', 'Morrelganj', 'Rampal', 'Sarankhola']
      },
      {
        name: 'Jhenaidah',
        upazilas: ['Jhenaidah Sadar', 'Harinakunda', 'Kaliganj', 'Kotchandpur', 'Maheshpur', 'Shailkupa']
      },
      {
        name: 'Chuadanga',
        upazilas: ['Chuadanga Sadar', 'Alamdanga', 'Damurhuda', 'Jibannagar']
      },
      {
        name: 'Magura',
        upazilas: ['Magura Sadar', 'Mohammadpur', 'Shalikha', 'Sreepur']
      },
      {
        name: 'Meherpur',
        upazilas: ['Meherpur Sadar', 'Gangni', 'Mujibnagar']
      },
      {
        name: 'Narail',
        upazilas: ['Narail Sadar', 'Kalia', 'Lohagara']
      }
    ]
  },
  {
    name: 'Barishal',
    districts: [
      {
        name: 'Barishal',
        upazilas: ['Barishal Sadar', 'Bakerganj', 'Babuganj', 'Wazirpur', 'Banaripara', 'Gournadi', 'Agailjhara', 'Mehendiganj', 'Muladi', 'Hizla']
      },
      {
        name: 'Patuakhali',
        upazilas: ['Patuakhali Sadar', 'Bauphal', 'Dashmina', 'Galachipa', 'Kalapara', 'Mirzaganj', 'Dumki', 'Rangabali']
      },
      {
        name: 'Bhola',
        upazilas: ['Bhola Sadar', 'Burhanuddin', 'Char Fasson', 'Daulatkhan', 'Lalmohan', 'Manpura', 'Tazumuddin']
      },
      {
        name: 'Pirojpur',
        upazilas: ['Pirojpur Sadar', 'Bhandaria', 'Kawkhali', 'Mathbaria', 'Nazirpur', 'Nesarabad', 'Zianagar']
      },
      {
        name: 'Barguna',
        upazilas: ['Barguna Sadar', 'Amtali', 'Bamna', 'Betagi', 'Patharghata', 'Taltali']
      },
      {
        name: 'Jhalokathi',
        upazilas: ['Jhalokathi Sadar', 'Kathalia', 'Nalchhiti', 'Rajapur']
      }
    ]
  },
  {
    name: 'Sylhet',
    districts: [
      {
        name: 'Sylhet',
        upazilas: ['Sylhet Sadar', 'Beanibazar', 'Bishwanath', 'Dakshin Surma', 'Fenchuganj', 'Golapganj', 'Gowainghat', 'Jaintiapur', 'Kanaighat', 'Companiganj', 'Zakiganj', 'Osmani Nagar']
      },
      {
        name: 'Moulvibazar',
        upazilas: ['Moulvibazar Sadar', 'Barlekha', 'Juri', 'Kamalganj', 'Kulaura', 'Rajnagar', 'Sreemangal']
      },
      {
        name: 'Habiganj',
        upazilas: ['Habiganj Sadar', 'Ajmiriganj', 'Bahubal', 'Baniachong', 'Chunarughat', 'Lakhai', 'Madhabpur', 'Nabiganj', 'Sayestaganj']
      },
      {
        name: 'Sunamganj',
        upazilas: ['Sunamganj Sadar', 'Bishwamvarpur', 'Chhatak', 'Derai', 'Dharampasha', 'Dowarabazar', 'Jagannathpur', 'Jamalganj', 'Sullah', 'Tahirpur', 'South Sunamganj']
      }
    ]
  },
  {
    name: 'Rangpur',
    districts: [
      {
        name: 'Rangpur',
        upazilas: ['Rangpur Sadar', 'Badarganj', 'Gangachhara', 'Kaunia', 'Mithapukur', 'Pirgachha', 'Pirganj', 'Taraganj']
      },
      {
        name: 'Dinajpur',
        upazilas: ['Dinajpur Sadar', 'Birampur', 'Birganj', 'Biral', 'Bochaganj', 'Chirirbandar', 'Fulbari', 'Ghoraghat', 'Hakimpur', 'Kaharole', 'Khansama', 'Nawabganj', 'Parbatipur']
      },
      {
        name: 'Kurigram',
        upazilas: ['Kurigram Sadar', 'Nageshwari', 'Bhurungamari', 'Phulbari', 'Rajarhat', 'Ulipur', 'Chilmari', 'Rowmari', 'Char Rajibpur']
      },
      {
        name: 'Gaibandha',
        upazilas: ['Gaibandha Sadar', 'Gobindaganj', 'Palashbari', 'Sadullapur', 'Sughatta', 'Sundarganj', 'Phulchhari']
      },
      {
        name: 'Nilphamari',
        upazilas: ['Nilphamari Sadar', 'Saidpur', 'Jaldhaka', 'Kishoreganj', 'Domar', 'Dimla']
      },
      {
        name: 'Lalmonirhat',
        upazilas: ['Lalmonirhat Sadar', 'Aditmari', 'Kaliganj', 'Hatibandha', 'Patgram']
      },
      {
        name: 'Panchagarh',
        upazilas: ['Panchagarh Sadar', 'Boda', 'Debiganj', 'Atwari', 'Tetulia']
      },
      {
        name: 'Thakurgaon',
        upazilas: ['Thakurgaon Sadar', 'Pirganj', 'Ranisankail', 'Haripur', 'Baliadangi']
      }
    ]
  },
  {
    name: 'Mymensingh',
    districts: [
      {
        name: 'Mymensingh',
        upazilas: ['Mymensingh Sadar', 'Muktagachha', 'Fulbaria', 'Trishal', 'Bhaluka', 'Gafargaon', 'Nandail', 'Ishwarganj', 'Haluaghat', 'Dhobaura', 'Gouripur', 'Phulpur', 'Tara Khanda']
      },
      {
        name: 'Jamalpur',
        upazilas: ['Jamalpur Sadar', 'Baksiganj', 'Dewanganj', 'Islampur', 'Madarganj', 'Melandaha', 'Sarishabari']
      },
      {
        name: 'Netrokona',
        upazilas: ['Netrokona Sadar', 'Atpara', 'Barhatta', 'Durgapur', 'Khaliajuri', 'Kalmakanda', 'Kendua', 'Madan', 'Mohanganj', 'Purbadhala']
      },
      {
        name: 'Sherpur',
        upazilas: ['Sherpur Sadar', 'Jhenaigati', 'Nakla', 'Nalitabari', 'Sreebardi']
      }
    ]
  }
];

export function getDistrictsForDivision(divisionName: string): DistrictInfo[] {
  const division = BANGLADESH_DIVISIONS.find(d => d.name.toLowerCase() === divisionName.toLowerCase());
  return division ? division.districts : [];
}

export function getUpazilasForDistrict(divisionName: string, districtName: string): string[] {
  const division = BANGLADESH_DIVISIONS.find(d => d.name.toLowerCase() === divisionName.toLowerCase());
  if (!division) return [];
  const district = division.districts.find(dst => dst.name.toLowerCase() === districtName.toLowerCase());
  return district ? district.upazilas : [];
}
